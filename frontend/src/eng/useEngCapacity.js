import * as React from 'react';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
const { useState, useRef, useEffect } = React;
import {
    applyCapacitySaveResultForScope,
    beginCapacityReadOwnership,
    buildCapacityScopeSignature,
    buildCapacityTotals,
    buildCapacityTotalsSummary,
    buildDisplayedTeamOptions,
    buildExcludedCapacityByTeamId,
    buildPlannedCapacityByTeam,
    buildProjectCapacity,
    buildSelectedProjectEntries,
    buildSelectedTeamEntries,
    buildTeamCapacityEntries,
    buildTeamCapacityStats,
    buildTeamSpTotals,
    getCapacityShareLabel,
    getCapacityStatus,
    isUnresolvedCapacityTeam,
    normalizeCapacityKey,
    normalizeCapacityTeamName,
    reduceCapacityReadLifecycle,
    resolvePlannedCapacity,
    resolveUniqueCapacityValue,
} from './planningCapacityUtils.js';
import { buildExcludedProjectStats, buildSelectedAdHocStats, buildSelectedProjectStats, buildSelectedTeamProjectStats, buildSelectedTeamStats } from './planningSelectionStats.js';
import { fetchCapacity as requestCapacity } from '../api/capacityApi.js';

export function useEngCapacityState() {
    const [capacityState, setCapacityState] = useState(() => ({ capacityByTeam: {}, capacityTargetsByTeam: {}, capacityIssueCount: null, mutationEnabled: false, scopeSignature: '' }));
    const capacityStateRef = useRef(capacityState);
    capacityStateRef.current = capacityState;
    const [capacityLoading, setCapacityLoading] = useState(false);
    const [capacityReadRevision, setCapacityReadRevision] = useState(0);
    const [capacityReadError, setCapacityReadError] = useState('');
    const [capacityDataStale, setCapacityDataStale] = useState(false);
    const capacityReadModelRef = useRef(null);
    capacityReadModelRef.current = {
        capacityState, capacityLoading, capacityReadRevision, capacityReadError, capacityDataStale,
    };
    const [capacityRefreshNonce, setCapacityRefreshNonce] = useState(0);
    const capacityReadGenerationRef = useRef(0);
    const capacityReadAbortRef = useRef(null);
    const activeCapacityScopeRef = useRef(''), capacityScopeHoldRef = useRef(0), capacityScopePinRef = useRef(null), capacityScopeKeyRef = useRef(null);
    const capacityReadGuardRef = useRef(null), activeCapacityTeamsRef = useRef([]);
    return {
        capacityState, setCapacityState, capacityStateRef, capacityLoading,
        setCapacityLoading, capacityReadRevision, setCapacityReadRevision, capacityReadError,
        setCapacityReadError, capacityDataStale, setCapacityDataStale, capacityReadModelRef,
        capacityRefreshNonce, setCapacityRefreshNonce, capacityReadGenerationRef, capacityReadAbortRef,
        activeCapacityScopeRef, capacityScopeHoldRef, capacityScopePinRef, capacityScopeKeyRef, capacityReadGuardRef, activeCapacityTeamsRef,
    };
}

export function useEngCapacity({
    scope,
    showPlanning, capacityEnabled, showProduct, showTech,
    selectedTasksList, selectedPlanningTasksList, selectedSP, getTeamInfo,
    normalizeStatus, normalizeEpicKey, BACKEND_URL, loadEpochRef,
    epicGroups, epicRefMap, capacityState, capacityStateRef,
    setCapacityState, setCapacityLoading, setCapacityReadRevision, setCapacityReadError,
    setCapacityDataStale, capacityReadModelRef, capacityRefreshNonce, setCapacityRefreshNonce,
    capacityReadGenerationRef, capacityReadAbortRef, activeCapacityScopeRef, capacityScopeHoldRef,
    capacityScopePinRef, capacityScopeKeyRef, capacityReadGuardRef, activeCapacityTeamsRef,
    // #323: the stored numbers of the displayed Teams (`getPlannedNumbers()`) and the Jira read lifecycle that gates them.
    plannedCapacity = null, capacityLoading = false, capacityReadError = '', capacityDataStale = false,
}) {
    const { activeGroupId, selectedSprintInfo, isAllTeamsSelected, selectedTeamSet, teamOptions, capacityTasks, techProjectKeys, excludedEpicSet, adHocEpicSet, adHocEpicSignature, cardTeamIds } = scope;
    const selectedTeamStats = React.useMemo(() => {
        if (!showPlanning) return {};
        return buildSelectedTeamStats(selectedTasksList, getTeamInfo);
    }, [showPlanning, selectedTasksList]);

    const selectedProjectStats = React.useMemo(() => {
        if (!showPlanning) return {};
        return buildSelectedProjectStats(selectedPlanningTasksList, techProjectKeys, adHocEpicSet);
    }, [showPlanning, selectedPlanningTasksList, techProjectKeys, adHocEpicSet, adHocEpicSignature]);

    const selectedTeamProjectStats = React.useMemo(() => {
        if (!showPlanning) return {};
        return buildSelectedTeamProjectStats(selectedPlanningTasksList, getTeamInfo, techProjectKeys, adHocEpicSet);
    }, [showPlanning, selectedPlanningTasksList, techProjectKeys, adHocEpicSet, adHocEpicSignature]);

    // Ad Hoc story points already counted inside their side's bucket (always PRODUCT in Legacy; the
    // Allocation side in DELIVERY), surfaced separately so the split bar can draw each Ad Hoc portion.
    const selectedAdHocStats = React.useMemo(() => {
        if (!showPlanning || adHocEpicSet.size === 0) return {};
        return buildSelectedAdHocStats(selectedPlanningTasksList, techProjectKeys, adHocEpicSet);
    }, [showPlanning, selectedPlanningTasksList, techProjectKeys, adHocEpicSet, adHocEpicSignature]);
    const selectedAdHocProductSP = selectedAdHocStats.PRODUCT || 0;

    const excludedProjectStats = React.useMemo(() => {
        if (!showPlanning) return {};
        return buildExcludedProjectStats(selectedTasksList, excludedEpicSet, techProjectKeys, normalizeEpicKey);
    }, [showPlanning, selectedTasksList, excludedEpicSet, techProjectKeys]);

    const capacitySplit = React.useMemo(() => ({ product: 0.7, tech: 0.3 }), []);
    const capacityMultiplier = (showProduct && showTech)
        ? 1
        : showProduct
            ? capacitySplit.product
            : showTech
                ? capacitySplit.tech
                : 1;
    const capacityShareLabel = getCapacityShareLabel({ showProduct, showTech, capacitySplit });

    const teamCapacityStats = React.useMemo(() => {
        return buildTeamCapacityStats({
            showPlanning,
            capacityEnabled,
            capacityTasks,
            normalizeStatus,
            getTeamInfo,
            techProjectKeys,
            adHocEpicSet
        });
    }, [showPlanning, capacityEnabled, capacityTasks, techProjectKeys, adHocEpicSet, adHocEpicSignature]);

    const teamCapacityEntries = React.useMemo(() => {
        return buildTeamCapacityEntries(teamCapacityStats);
    }, [teamCapacityStats]);

    const displayedTeamCapacityEntries = React.useMemo(() => {
        return !isAllTeamsSelected
            ? teamCapacityEntries.filter(entry => selectedTeamSet.has(entry.id))
            : teamCapacityEntries;
    }, [teamCapacityEntries, isAllTeamsSelected, selectedTeamSet]);

    const teamSpTotals = React.useMemo(() => {
        return buildTeamSpTotals(capacityTasks, getTeamInfo);
    }, [capacityTasks]);

    const displayedTeamOptions = React.useMemo(() => {
        return buildDisplayedTeamOptions({
            teamOptions,
            isAllTeamsSelected,
            selectedTeamSet,
            teamSpTotals,
            cardTeamIds
        });
    }, [teamOptions, isAllTeamsSelected, selectedTeamSet, teamSpTotals, cardTeamIds]);

    // Resolver options per Team (#323): a zero-effort Team matches exactly only, and no Team borrows another configured
    // Team's ticket or stored number by containment.
    const matchOptions = React.useMemo(() => {
        const configuredTeamKeys = new Set(teamOptions.filter(team => team.id !== 'all').map(team => normalizeCapacityKey(team.name)).filter(Boolean));
        const exactOnlyKeys = new Set(displayedTeamOptions.filter(team => !(teamSpTotals[team.id] > 0)).map(team => normalizeCapacityKey(team.name)));
        return teamName => ({ exactOnly: exactOnlyKeys.has(normalizeCapacityKey(teamName)), configuredTeamKeys });
    }, [teamOptions, displayedTeamOptions, teamSpTotals]);

    const capacityTeamNames = React.useMemo(() => {
        if (!showPlanning || !capacityEnabled) return [];
        const teamsByKey = new Map();
        for (const team of displayedTeamOptions) {
            if (isUnresolvedCapacityTeam(team)) continue;
            const teamName = normalizeCapacityTeamName(team.name);
            const key = normalizeCapacityKey(teamName);
            if (key && !teamsByKey.has(key)) teamsByKey.set(key, teamName);
        }
        return Array.from(teamsByKey.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([, teamName]) => teamName);
    }, [showPlanning, capacityEnabled, displayedTeamOptions]);

    // A per-epic refresh (#213) pins the previous signature until the scope changes or a department load bumps loadEpochRef (read during render on purpose: loads set state, so a render follows); the trade-off is that a team crossing zero Story Points is not reread until then.
    const capacityScopeKey = [selectedSprintInfo?.name, activeGroupId, showPlanning, capacityEnabled, loadEpochRef.current, isAllTeamsSelected, [...selectedTeamSet].sort().join(',')].join('|');
    if (capacityScopeKeyRef.current !== capacityScopeKey) { capacityScopeKeyRef.current = capacityScopeKey; capacityScopePinRef.current = null; activeCapacityScopeRef.current = ''; }
    if (showPlanning && capacityScopeHoldRef.current && activeCapacityScopeRef.current && !capacityScopePinRef.current) capacityScopePinRef.current = { key: capacityScopeKey, signature: activeCapacityScopeRef.current, teams: [...activeCapacityTeamsRef.current] };
    const capacityScopeSignature = capacityScopePinRef.current ? capacityScopePinRef.current.signature : buildCapacityScopeSignature(
        selectedSprintInfo?.name || '',
        capacityTeamNames,
    );
    const requestTeamNames = capacityScopePinRef.current?.teams || capacityTeamNames;
    activeCapacityScopeRef.current = capacityScopeSignature;
    activeCapacityTeamsRef.current = requestTeamNames;

    const commitCapacityReadLifecycle = (event) => {
        const nextModel = reduceCapacityReadLifecycle(capacityReadModelRef.current, event);
        capacityReadModelRef.current = nextModel;
        capacityStateRef.current = nextModel.capacityState;
        setCapacityState(nextModel.capacityState);
        setCapacityLoading(nextModel.capacityLoading);
        setCapacityReadRevision(nextModel.capacityReadRevision);
        setCapacityReadError(nextModel.capacityReadError);
        setCapacityDataStale(nextModel.capacityDataStale);
    };

    // The displayed Teams' stored numbers keyed like capacityByTeam, for the selected Sprint.
    const plannedCapacityByTeam = React.useMemo(() => buildPlannedCapacityByTeam({ plannedCapacity, displayedTeamOptions, sprintId: selectedSprintInfo?.id }), [plannedCapacity, displayedTeamOptions, selectedSprintInfo?.id]);
    // Merged after the scope check, into capacityByTeam only: targets, the issue count and mutationEnabled stay Jira's.
    const { effectiveCapacityState, plannedCapacityKeys } = React.useMemo(() => {
        if (capacityState.scopeSignature === capacityScopeSignature) {
            const planned = resolvePlannedCapacity({
                capacityState, teamNames: displayedTeamOptions.filter(team => !isUnresolvedCapacityTeam(team)).map(team => team.name), plannedCapacityByTeam, matchOptions,
                capacityEnabled, capacityLoading, capacityReadError, capacityDataStale,
            });
            const merged = planned.fallbackKeys.size ? {
                capacityByTeam: { ...capacityState.capacityByTeam, ...planned.capacityByTeam }, capacityTargetsByTeam: capacityState.capacityTargetsByTeam,
                capacityIssueCount: capacityState.capacityIssueCount, mutationEnabled: capacityState.mutationEnabled, scopeSignature: capacityState.scopeSignature,
            } : capacityState;
            return { effectiveCapacityState: merged, plannedCapacityKeys: planned };
        }
        return { effectiveCapacityState: { capacityByTeam: {}, capacityTargetsByTeam: {}, capacityIssueCount: null, mutationEnabled: false, scopeSignature: capacityScopeSignature }, plannedCapacityKeys: null };
    }, [capacityState, capacityScopeSignature, displayedTeamOptions, plannedCapacityByTeam, matchOptions, capacityEnabled, capacityLoading, capacityReadError, capacityDataStale]);
    const { capacityByTeam, capacityTargetsByTeam } = effectiveCapacityState;
    const capacityMutationEnabled = effectiveCapacityState.mutationEnabled === true;

    const handleCapacitySaved = React.useCallback((result) => {
        if (result.scopeSignature !== activeCapacityScopeRef.current) return;
        setCapacityState((previous) => {
            const nextState = applyCapacitySaveResultForScope(
                previous,
                result,
                activeCapacityScopeRef.current,
            );
            capacityStateRef.current = nextState;
            capacityReadModelRef.current = {
                ...capacityReadModelRef.current,
                capacityState: nextState,
            };
            return nextState;
        });
    }, []);
    const retryCapacity = React.useCallback(() => {
        capacityReadGuardRef.current?.onSettled({ status: 'ignored' }); capacityReadGuardRef.current = null;
        setCapacityRefreshNonce(previous => previous + 1);
    }, []);
    const refreshCapacity = React.useCallback(({ signal, shouldApply, automatic = true } = {}) => new Promise((resolve, reject) => {
        let settled = false;
        const onSettled = (outcome, error) => { if (settled) return; settled = true; signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(outcome); };
        const abort = () => { if (capacityReadGuardRef.current === guard) onSettled({ status: 'ignored' }); };
        capacityReadGuardRef.current?.onSettled({ status: 'ignored' });
        const guard = { signal, shouldApply, onSettled, automatic, scopeSignature: activeCapacityScopeRef.current };
        capacityReadGuardRef.current = guard;
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        setCapacityRefreshNonce(previous => previous + 1);
    }), []);
    const fetchCapacity = async ({ sprintName, teams, signal, scopeSignature, ownership, guard }) => {
        const current = () => ownership.isCurrent() && !signal.aborted && (!guard || (!guard.signal?.aborted && guard.shouldApply?.() !== false));
        let outcome = { status: 'ignored' };
        try {
            const response = await requestCapacity(BACKEND_URL, { sprintName, teams, signal });
            if (!response.ok) throw Object.assign(new Error(`capacity_read_${response.status}`), { status: response.status });
            const data = await response.json();
            if (!current()) return;
            outcome = { status: 'ok' };
            commitCapacityReadLifecycle({ type: 'success', scopeSignature, payload: data });
        } catch (error) {
            if (isAuthenticationRequiredError(error)) { guard?.onSettled(null, error); return; }
            if (error?.name === 'AbortError' || !current()) return;
            outcome = { status: 'failed' };
            if (!guard || guard.automatic === false) commitCapacityReadLifecycle({ type: 'failure', scopeSignature });
        } finally {
            guard?.onSettled(outcome);
            if (ownership.isCurrent() && capacityReadAbortRef.current?.signal === signal) capacityReadAbortRef.current = null;
        }
    };

    useEffect(() => {
        let guard = capacityReadGuardRef.current;
        if (capacityReadGuardRef.current === guard) capacityReadGuardRef.current = null;
        const scopeSignature = capacityScopeSignature;
        if (guard && guard.scopeSignature !== scopeSignature) { guard.onSettled({ status: 'ignored' }); guard = null; }
        const sprintName = selectedSprintInfo?.name || '';
        const ownership = beginCapacityReadOwnership({
            generationRef: capacityReadGenerationRef,
            abortRef: capacityReadAbortRef,
            activeScopeRef: activeCapacityScopeRef,
            scopeSignature,
            capacityEnabled,
            showPlanning,
            sprintName,
            teams: requestTeamNames,
        });

        let fetchStarted = false;
        const abort = () => { ownership.controller?.abort(); };
        guard?.signal?.addEventListener('abort', abort, { once: true });
        if (guard && (guard.signal?.aborted || guard.shouldApply?.() === false)) abort();
        if (!ownership.shouldFetch || guard?.signal?.aborted || guard?.shouldApply?.() === false) {
            guard?.onSettled({ status: 'ignored' });
            if ((!guard || guard.automatic === false) && ownership.isCurrent()) {
                commitCapacityReadLifecycle({ type: 'gate', scopeSignature });
            }
        } else {
            if ((!guard || guard.automatic === false) && ownership.isCurrent()) {
                commitCapacityReadLifecycle({ type: 'start', scopeSignature });
            }
            fetchStarted = true;
            void fetchCapacity({
                sprintName,
                teams: requestTeamNames,
                signal: ownership.controller.signal,
                scopeSignature,
                ownership, guard,
            });
        }

        return () => { guard?.signal?.removeEventListener('abort', abort); ownership.cleanup(); if (!fetchStarted) guard?.onSettled({ status: 'ignored' }); };
    }, [capacityEnabled, showPlanning, capacityScopeSignature, capacityRefreshNonce]);

    const capacityTeamIds = React.useMemo(() => {
        return !isAllTeamsSelected
            ? Array.from(selectedTeamSet)
            : teamCapacityEntries.map(entry => entry.id);
    }, [isAllTeamsSelected, selectedTeamSet, teamCapacityEntries]);

    const getTeamCapacity = (teamName) => {
        if (!capacityEnabled) return 0;
        const resolved = resolveUniqueCapacityValue(capacityByTeam, teamName, matchOptions(teamName));
        return resolved.matched ? resolved.value : 0;
    };

    const excludedCapacityByTeamId = React.useMemo(() => {
        return buildExcludedCapacityByTeamId({
            capacityEnabled,
            showPlanning,
            capacityTasks,
            excludedEpicSet,
            normalizeEpicKey,
            getTeamInfo
        });
    }, [capacityEnabled, showPlanning, capacityTasks, excludedEpicSet]);

    const getTeamNetCapacity = (team) => {
        if (!capacityEnabled) return 0;
        const base = getTeamCapacity(team.name);
        const excluded = excludedCapacityByTeamId[team.id] || 0;
        return Math.max(0, base - excluded);
    };

    const capacityTotalsSummary = React.useMemo(() => {
        return buildCapacityTotalsSummary({
            capacityEnabled,
            displayedTeamOptions,
            getTeamCapacity,
            excludedCapacityByTeamId,
            capacityMultiplier
        });
    }, [capacityEnabled, displayedTeamOptions, excludedCapacityByTeamId, capacityMultiplier, capacityByTeam, matchOptions]);
    const totalCapacityBase = capacityTotalsSummary.totalCapacityBase;
    const excludedCapacityTotal = capacityTotalsSummary.excludedCapacityTotal;
    const estimatedCapacityRaw = capacityTotalsSummary.estimatedCapacityRaw;
    const totalCapacityAdjusted = capacityTotalsSummary.totalCapacityAdjusted;
    const estimatedCapacityAdjusted = capacityTotalsSummary.estimatedCapacityAdjusted;
    const excludedCapacityAdjusted = capacityTotalsSummary.excludedCapacityAdjusted;
    const capacitySummary = getCapacityStatus(selectedSP, totalCapacityAdjusted);
    const scrollToFirstExcludedEpic = (projectType = 'any') => {
        const firstExcluded = epicGroups.find((epic) => {
            if (!excludedEpicSet.has(normalizeEpicKey(epic.key))) return false;
            if (projectType === 'any') return true;
            const hasTech = (epic.tasks || []).some(task => techProjectKeys.has(String(task.fields?.projectKey || String(task.key || '').split('-')[0]).toUpperCase()));
            const hasProduct = (epic.tasks || []).some(task => !techProjectKeys.has(String(task.fields?.projectKey || String(task.key || '').split('-')[0]).toUpperCase()));
            return projectType === 'tech' ? hasTech : hasProduct;
        });
        if (!firstExcluded) return;
        const node = epicRefMap.current.get(firstExcluded.key);
        if (!node) return;
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.remove('epic-flash');
        void node.offsetWidth;
        node.classList.add('epic-flash');
    };

    const projectCapacity = React.useMemo(() => {
        return buildProjectCapacity({
            showPlanning,
            capacityEnabled,
            displayedTeamOptions,
            selectedTeamProjectStats,
            getTeamNetCapacity,
            capacitySplit,
            showProduct,
            showTech
        });
    }, [
        showPlanning,
        capacityEnabled,
        displayedTeamOptions,
        selectedTeamProjectStats,
        showProduct,
        showTech,
        capacitySplit,
        capacityByTeam,
        excludedCapacityByTeamId,
        matchOptions
    ]);

    const selectedProjectEntries = React.useMemo(() => {
        return buildSelectedProjectEntries({
            showPlanning,
            selectedProjectStats,
            capacityEnabled,
            projectCapacity
        });
    }, [showPlanning, selectedProjectStats, capacityEnabled, projectCapacity]);

    const selectedTeamEntries = React.useMemo(() => {
        const entries = buildSelectedTeamEntries({
            showPlanning,
            displayedTeamOptions,
            selectedTeamStats,
            capacityEnabled,
            capacityByTeam,
            capacityTargetsByTeam,
            getTeamCapacity,
            getTeamNetCapacity,
            capacityMultiplier,
            matchOptions
        });
        // Where each card's number comes from, whether the "no ticket" predicate lets it edit the stored number, and
        // whether the Team has effort (D2: the "Capacity:" availability judges Teams with effort or a value).
        return entries.map((entry) => {
            const key = normalizeCapacityKey(entry.name);
            const planned = Boolean(plannedCapacityKeys?.fallbackKeys.has(key));
            return { ...entry, capacitySource: planned ? 'planned' : entry.hasCapacityValue ? 'jira' : '', plannedEditable: Boolean(plannedCapacityKeys?.noTicketKeys.has(key)), hasEffort: (teamSpTotals[entry.id] || 0) > 0 };
        });
    }, [
        showPlanning,
        displayedTeamOptions,
        selectedTeamStats,
        capacityEnabled,
        capacityMultiplier,
        capacityByTeam,
        capacityTargetsByTeam,
        excludedCapacityByTeamId,
        plannedCapacityKeys,
        matchOptions,
        teamSpTotals
    ]);

    const capacityTotals = React.useMemo(() => {
        return buildCapacityTotals({
            showPlanning,
            capacityEnabled,
            displayedTeamCapacityEntries
        });
    }, [showPlanning, capacityEnabled, displayedTeamCapacityEntries]);

    const showTotalsRow = displayedTeamCapacityEntries.length > 1;

    const formatCapacityValue = (value) => {
        const num = Number(value || 0);
        return num.toFixed(1);
    };

    return {
        selectedAdHocProductSP, selectedAdHocStats, excludedProjectStats, capacityShareLabel, teamCapacityEntries,
        displayedTeamCapacityEntries, capacityScopeSignature, effectiveCapacityState, capacityMutationEnabled,
        handleCapacitySaved, retryCapacity, refreshCapacity, capacityTeamIds, totalCapacityAdjusted,
        estimatedCapacityAdjusted, excludedCapacityAdjusted, capacitySummary, selectedProjectEntries,
        selectedTeamEntries, capacityTotals, showTotalsRow, formatCapacityValue,
    };
}
