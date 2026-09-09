import * as React from 'react';
import { streamEngBoard } from '../api/engBoardApi.js';
import { recordPerformanceLoad } from '../api/performanceApi.js';
import { createBoardLoadMeasurement, isAcceptedBoardTerminalSample } from './loadPerformance.js';
import { useEngBoardData } from './useEngBoardData.js';
import { buildStrictEngBoardViewModel } from './engBoardViewModel.js';
import { matchesEngBoardSearch } from './engBoardSearch.js';
import { useEngBoardFilters } from './useEngBoardFilters.js';
import { createEngBoardMutationCoordinator } from './engBoardMutationCoordinator.js';

const strictProjectClassifier = task => task.projectClassification;
const canonicalKeys = values => [...new Set((values || [])
    .map(value => String(value || '').trim().toUpperCase())
    .filter(value => /^[A-Z][A-Z0-9_]*-\d+$/.test(value)))].sort();

export function useStrictEngBoardOwner({ active, backendUrl, departmentId, sprintId, groupRevision, strictScope = null,
    resolvedFocusColumnId, performanceGate, trackApiResult, onAuthRequired }) {
    const [issuePatchesByKey, setIssuePatchesByKey] = React.useState({});
    const mutationCoordinatorRef = React.useRef(null);
    if (!mutationCoordinatorRef.current) mutationCoordinatorRef.current = createEngBoardMutationCoordinator();
    const streamBoard = React.useCallback(
        options => streamEngBoard({ backendUrl, ...options }), [backendUrl]);
    const createMeasurement = React.useCallback(options => createBoardLoadMeasurement({
        enabled: performanceGate.enabled, ...options,
        emit: sample => {
            void recordPerformanceLoad(backendUrl, sample).catch(() => {});
            if (isAcceptedBoardTerminalSample(sample)) trackApiResult('eng_board', {
                featureName: 'eng_board', method: 'GET', status: sample.outcome === 'success' ? 200 : 503,
                durationMs: sample.durationMs, cacheState: sample.cacheState, scopeType: sample.scopeType,
            });
        },
    }), [backendUrl, performanceGate, trackApiResult]);
    const data = useEngBoardData({ active, departmentId, inheritedSprintId: sprintId, groupRevision, strictScope,
        resolvedFocusColumnId, streamBoard, createMeasurement, onAuthRequired });
    const refresh = React.useCallback(async () => {
        const outcome = await data.refresh();
        if (outcome === 'success') setIssuePatchesByKey({});
        return outcome;
    }, [data.refresh]);
    React.useEffect(() => setIssuePatchesByKey({}),
        [departmentId, data.scope?.type, data.scope?.sprintId]);
    const applyIssueField = React.useCallback((issueKey, fieldName, fieldValue) => {
        if (!active) return false;
        setIssuePatchesByKey(previous => ({ ...previous,
            [issueKey]: { ...(previous[issueKey] || {}), [fieldName]: fieldValue } }));
        return true;
    }, [active]);
    return { data, issuePatchesByKey, refresh, applyIssueField,
        mutationCoordinator: active ? mutationCoordinatorRef.current : null };
}

export function useStrictEngBoardPresentation({ active, owner, savedBoard, legacyFilterInput,
    searchQuery, showBoard, visibleTaskCount, trackSearch }) {
    const model = React.useMemo(() => buildStrictEngBoardViewModel(owner.data.displayData, {
        savedBoard, issuePatchesByKey: owner.issuePatchesByKey,
    }), [owner.data.displayData, savedBoard, owner.issuePatchesByKey]);
    const filterState = useEngBoardFilters({ ...legacyFilterInput,
        isTechTask: active ? strictProjectClassifier : legacyFilterInput.isTechTask,
        strictEpicGroups: active ? model.epicGroups : null,
        filtersEnabled: !active || model.membershipAuthoritative,
    });
    React.useEffect(() => {
        if (active && !model.membershipAuthoritative) return;
        const count = filterState.boardEpicGroups.filter(group => matchesEngBoardSearch(
            { key: group.key, ...group.epic }, searchQuery)).length;
        trackSearch(searchQuery, showBoard ? count : visibleTaskCount);
    }, [active, model.membershipAuthoritative, filterState.boardEpicGroups,
        searchQuery, showBoard, visibleTaskCount, trackSearch]);
    const workItemKeys = React.useMemo(() => active && model.childrenAuthoritative
        ? canonicalKeys(filterState.boardEpicGroupsFiltered.flatMap(
            group => (group.tasks || []).map(task => task.key))) : [],
    [active, model.childrenAuthoritative, filterState.boardEpicGroupsFiltered]);
    return { ...filterState, model, workItemKeys };
}

export function strictEngBoardViewProps({ active, owner, model, legacyLoading, legacyError, legacyRetry }) {
    return {
        strictColumns: active ? model.columns : null,
        loading: active ? owner.data.status === 'loading' : legacyLoading,
        error: active && owner.data.error
            ? `Board load failed: ${String(owner.data.error.code || 'jira_unavailable').replaceAll('_', ' ')}.`
            : legacyError,
        onRetry: active ? owner.data.retry : legacyRetry,
        authorityPending: active && !model.authoritative,
        stale: active && model.stale,
        onResolvedFocusChange: active ? owner.data.setResolvedFocus : undefined,
    };
}

export function strictEngBoardMutationProps({ active, coordinator, refresh, sourceSurface,
    loadLegacy, retrySubtasks }) {
    return {
        status: { mutationCoordinator: coordinator,
            onTransitionSuccessRefresh: async ({ affectedSubtaskStoryKeys = [] } = {}) => {
                if (active) await refresh();
                else if (sourceSurface !== 'board') loadLegacy();
                if (!active) affectedSubtaskStoryKeys.forEach(key => retrySubtasks({ key }));
            } },
        priority: { mutationCoordinator: coordinator,
            onPrioritySuccessRefresh: async () => { if (active) await refresh(); } },
        projectTrack: { mutationCoordinator: coordinator,
            onProjectTrackSuccessRefresh: () => active ? refresh() : Promise.resolve() },
    };
}
