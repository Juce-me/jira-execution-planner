import { classifyCapacityIssue } from '../capacityClassification.mjs';

export function normalizeCapacityTeamName(name) {
    if (!name) return '';
    return String(name)
        .replace(/\u00a0/g, ' ')
        .replace(/^\[archived\]\s*/i, '')
        .replace(/^r&d\s+/i, '')
        .replace(/^(product|tech)\s*-\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeCapacityKey(name) {
    return normalizeCapacityTeamName(name).toLowerCase();
}

export function buildCapacityScopeSignature(sprintName, teamNames = []) {
    const teams = Array.from(new Set(
        (Array.isArray(teamNames) ? teamNames : [])
            .map(normalizeCapacityKey)
            .filter(Boolean),
    )).sort((left, right) => left.localeCompare(right));
    return JSON.stringify({ sprintName: String(sprintName || ''), teams });
}

function resolveUniqueCapacityCandidate(valuesByTeam, teamName) {
    const key = normalizeCapacityKey(teamName);
    if (!key || !valuesByTeam || typeof valuesByTeam !== 'object') {
        return { matched: false, ambiguous: false, value: null };
    }

    const entries = Object.entries(valuesByTeam)
        .map(([candidateName, value]) => ({ key: normalizeCapacityKey(candidateName), value }))
        .filter(candidate => candidate.key);
    const exact = entries.filter(candidate => candidate.key === key);
    if (exact.length === 1) {
        return { matched: true, ambiguous: false, value: exact[0].value };
    }
    if (exact.length > 1) {
        return { matched: false, ambiguous: true, value: null };
    }

    const candidates = entries.filter(candidate => candidate.key.includes(key) || key.includes(candidate.key));
    if (candidates.length === 1) {
        return { matched: true, ambiguous: false, value: candidates[0].value };
    }
    return { matched: false, ambiguous: candidates.length > 1, value: null };
}

export function resolveUniqueCapacityValue(capacityByTeam, teamName) {
    const resolved = resolveUniqueCapacityCandidate(capacityByTeam, teamName);
    return resolved.matched
        ? { matched: true, value: resolved.value }
        : { matched: false, value: null };
}

export function resolveUniqueCapacityTarget(capacityTargetsByTeam, teamName) {
    const resolved = resolveUniqueCapacityCandidate(capacityTargetsByTeam, teamName);
    if (resolved.matched) return resolved.value;
    return { state: resolved.ambiguous ? 'ambiguous' : 'missing' };
}

export function buildCapacityReadState(payload = {}) {
    const capacityByTeam = {};
    for (const [teamName, capacity] of Object.entries(payload?.capacities || {})) {
        const key = normalizeCapacityKey(teamName);
        if (!key || typeof capacity !== 'number' || !Number.isFinite(capacity)) continue;
        capacityByTeam[key] = capacity;
    }

    const targetsByKey = new Map();
    for (const entry of Array.isArray(payload?.entries) ? payload.entries : []) {
        const teamName = normalizeCapacityTeamName(entry?.teamName);
        const issueKey = typeof entry?.issueKey === 'string' ? entry.issueKey.trim() : '';
        const key = normalizeCapacityKey(teamName);
        if (!key || !issueKey) continue;
        const capacity = typeof entry?.capacity === 'number' && Number.isFinite(entry.capacity)
            ? entry.capacity
            : null;
        if (!targetsByKey.has(key)) targetsByKey.set(key, new Map());
        const issues = targetsByKey.get(key);
        if (!issues.has(issueKey)) {
            issues.set(issueKey, { state: 'matched', issueKey, teamName, capacity });
        }
    }

    const capacityTargetsByTeam = {};
    for (const [key, issues] of targetsByKey.entries()) {
        capacityTargetsByTeam[key] = issues.size === 1
            ? issues.values().next().value
            : { state: 'ambiguous' };
    }
    return {
        capacityByTeam,
        capacityTargetsByTeam,
        mutationEnabled: payload?.mutationEnabled === true,
    };
}

export function applyCapacitySaveResult(state, result) {
    if (!state || !result || typeof result.issueKey !== 'string' || typeof result.teamName !== 'string') {
        return state;
    }
    if (typeof result.capacity !== 'number' || !Number.isFinite(result.capacity) || result.capacity < 0) {
        return state;
    }
    const key = normalizeCapacityKey(result.teamName);
    const target = state.capacityTargetsByTeam?.[key];
    if (
        !key || target?.state !== 'matched'
        || target.issueKey !== result.issueKey
        || normalizeCapacityKey(target.teamName) !== key
    ) {
        return state;
    }
    return {
        ...state,
        capacityByTeam: { ...state.capacityByTeam, [key]: result.capacity },
        capacityTargetsByTeam: {
            ...state.capacityTargetsByTeam,
            [key]: { ...target, capacity: result.capacity },
        },
    };
}

export function applyCapacitySaveResultForScope(state, result, activeScopeSignature) {
    if (
        !state || !result
        || result.scopeSignature !== activeScopeSignature
        || state.scopeSignature !== result.scopeSignature
    ) {
        return state;
    }
    return applyCapacitySaveResult(state, result);
}

function emptyCapacityState(scopeSignature) {
    return {
        capacityByTeam: {},
        capacityTargetsByTeam: {},
        mutationEnabled: false,
        scopeSignature,
    };
}

export function reduceCapacityReadLifecycle(model, event) {
    if (!model || !event || typeof event.scopeSignature !== 'string') return model;
    const { scopeSignature } = event;
    if (event.type === 'gate') {
        return {
            ...model,
            capacityState: emptyCapacityState(scopeSignature),
            capacityLoading: false,
            capacityReadError: '',
            capacityDataStale: false,
        };
    }
    if (event.type === 'start') {
        const scopeChanged = model.capacityState?.scopeSignature !== scopeSignature;
        return {
            ...model,
            capacityState: scopeChanged ? emptyCapacityState(scopeSignature) : model.capacityState,
            capacityLoading: true,
            capacityReadError: scopeChanged ? '' : model.capacityReadError,
            capacityDataStale: scopeChanged ? false : model.capacityDataStale,
        };
    }
    if (event.type === 'success') {
        const readState = event.payload?.enabled === true
            ? buildCapacityReadState(event.payload)
            : buildCapacityReadState({ mutationEnabled: false });
        return {
            ...model,
            capacityState: { ...readState, scopeSignature },
            capacityLoading: false,
            capacityReadRevision: model.capacityReadRevision + 1,
            capacityReadError: '',
            capacityDataStale: false,
        };
    }
    if (event.type === 'failure') {
        const previousState = model.capacityState?.scopeSignature === scopeSignature
            ? model.capacityState
            : emptyCapacityState(scopeSignature);
        const capacityByTeam = previousState.capacityByTeam || {};
        return {
            ...model,
            capacityState: {
                capacityByTeam,
                capacityTargetsByTeam: {},
                mutationEnabled: false,
                scopeSignature,
            },
            capacityLoading: false,
            capacityReadError: 'Capacity could not be refreshed.',
            capacityDataStale: Object.keys(capacityByTeam).length > 0,
        };
    }
    return model;
}

export function beginCapacityReadOwnership({
    generationRef,
    abortRef,
    activeScopeRef,
    scopeSignature,
    capacityEnabled,
    showPlanning,
    sprintName,
    teams,
    createAbortController = () => new AbortController(),
}) {
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    const shouldFetch = Boolean(
        capacityEnabled && showPlanning && sprintName && Array.isArray(teams) && teams.length > 0,
    );
    const controller = shouldFetch ? createAbortController() : null;
    if (controller) abortRef.current = controller;
    const isCurrent = () => (
        generation === generationRef.current
        && scopeSignature === activeScopeRef.current
    );
    const cleanup = () => {
        controller?.abort();
        if (abortRef.current === controller) abortRef.current = null;
        if (generationRef.current === generation) generationRef.current += 1;
    };
    return { controller, generation, shouldFetch, isCurrent, cleanup };
}

export function parseCapacityDraft(text) {
    if (typeof text !== 'string' || text.trim() === '') {
        return { valid: false, value: null };
    }
    const parsedValue = Number(text);
    const value = parsedValue === 0 ? 0 : parsedValue;
    return Number.isFinite(value) && value >= 0
        ? { valid: true, value }
        : { valid: false, value: null };
}

export function getCapacityShareLabel({ showProduct, showTech, capacitySplit }) {
    if (showProduct && !showTech) {
        return `Planning Product share ${Math.round(capacitySplit.product * 100)}%`;
    }
    if (showTech && !showProduct) {
        return `Planning Tech share ${Math.round(capacitySplit.tech * 100)}%`;
    }
    return '';
}

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
    capacityByTeam,
    capacityTargetsByTeam,
    getTeamCapacity,
    getTeamNetCapacity,
    capacityMultiplier
}) {
    if (!showPlanning) return [];
    return displayedTeamOptions.map((team) => {
        const target = resolveUniqueCapacityTarget(capacityTargetsByTeam, team.name);
        const numeric = resolveUniqueCapacityValue(capacityByTeam, team.name);
        const rawCapacity = numeric.matched ? numeric.value : null;
        return {
            id: team.id,
            name: team.name,
            storyPoints: selectedTeamStats[team.id]?.storyPoints || 0,
            teamCapacity: capacityEnabled ? getTeamCapacity(team.name) * capacityMultiplier : null,
            planningCapacity: capacityEnabled ? getTeamNetCapacity(team) * capacityMultiplier : null,
            rawCapacity,
            hasCapacityValue: numeric.matched,
            capacityIssueKey: target.state === 'matched' ? target.issueKey : '',
            capacityTargetTeamName: target.state === 'matched' ? target.teamName : '',
            capacityTargetCapacity: target.state === 'matched' ? target.capacity : null,
            capacityTargetState: target.state,
        };
    });
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
