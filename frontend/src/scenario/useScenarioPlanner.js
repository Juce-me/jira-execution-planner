import * as React from 'react';
import { parseScenarioDate, normalizeScenarioSummary, SCENARIO_BAR_HEIGHT, SCENARIO_BAR_GAP, SCENARIO_COLLAPSED_ROWS, SCENARIO_TEAM_LEAD_ROWS } from './scenarioUtils.js';
import { useScenarioDraft } from './useScenarioDraft.js';
import { useScenarioRealtime } from './useScenarioRealtime.js';
import { useScenarioDerived } from './useScenarioDerived.js';
import { useScenarioDrag } from './useScenarioDrag.js';
import { useScenarioHistory } from './useScenarioHistory.js';
import { buildLaneIssues } from './scenarioLaneUtils.js';
import { readPendingAuthenticationRequired } from '../api/authRequired.js';
import { collectJiraExportKeysFromScenarioIssues } from '../jiraExportUtils.mjs';
import { useEffect } from 'react';

export function useScenarioPlanner({
    scenarioState,
    BACKEND_URL,
    EMPTY_ARRAY,
    EMPTY_OBJECT,
    perfEnabled,
    perfCountersRef,
    pendingConnectionRecoveryRef,
    releaseConnectionRecoveryOwnership,
    connectionRecoveryScenarioStartedRef,
    setConnectionRecoveryNotice,
    setConnectionRecoveryStatus,
    connectionRecoveryStagedRevision,
    selectedSprint,
    availableSprints,
    sprintsLoading,
    groupsLoading,
    activeGroupId,
    jiraUrl,
    showScenario,
    searchQuery,
    pendingShellAuthResumeRef,
    selectedSprintInfo,
    trackScenarioAction,
    visibleControlGroups,
    selectedSprintState,
    isCompletedSprintSelected,
    normalizeEpicKey,
    registerSprintFetch,
    cleanupSprintFetch,
    activeGroup,
    teamOptions,
    selectedTeamSet,
    isAllTeamsSelected,
    excludedEpicSet,
}) {
    const {
        scenarioData,
        scenarioLaneMode,
        setScenarioLaneMode,
        scenarioShowConflictsOnly,
        scenarioTimelineRef,
        scenarioLayout,
        setScenarioLayout,
        scenarioCollapsedLanes,
        setScenarioCollapsedLanes,
        scenarioHoverKey,
        setScenarioFlashKey,
        scenarioScrollTop,
        setScenarioScrollTop,
        setScenarioScrollLeft,
        scenarioViewportHeight,
        setScenarioViewportHeight,
        scenarioEpicFocus,
        setScenarioEpicFocus,
        scenarioRangeOverride,
        setScenarioRangeOverride,
        scenarioFocusRestoreRef,
        scenarioSkipAutoCollapseRef,
        scenarioTeamCollapseInitRef,
        scenarioEdgeUpdatePendingRef,
        scenarioEdgeFrameRef,
        scenarioScrollFrameRef,
        scenarioResizeFrameRef,
        scenarioPendingScrollRef,
        setScenarioTooltip,
        scenarioTooltipRef,
        scenarioTooltipAnchorRef,
        scenarioIssueRefMap,
        setScenarioEdgeRender,
    } = scenarioState;
    let scheduleScenarioEdgeUpdate;

    const registerScenarioIssueRef = (issueKey) => (node) => {
        const map = scenarioIssueRefMap.current;
        if (node) {
            map.set(issueKey, node);
        } else {
            map.delete(issueKey);
        }
    };

    const {
        fetchScenarioDraft,
        pauseScenarioRealtime,
        postScenarioRealtimeJson,
        pollScenarioDraftEvents,
        saveScenarioDraftVersion,
        fetchScenarioDraftVersion,
        rollbackScenarioDraft,
        reloadScenarioDraftFromJira,
        buildScenarioDraftScope,
        runScenario,
        scenarioScopeKey,
        scenarioHasUnsavedChanges,
        scenarioCanSaveDraft,
        scenarioActiveDraftId,
        isScenarioScopeDraftCurrent,
        scenarioActiveDraftReady,
    } = useScenarioDraft({
        scenarioState,
        BACKEND_URL,
        pendingConnectionRecoveryRef,
        releaseConnectionRecoveryOwnership,
        connectionRecoveryScenarioStartedRef,
        setConnectionRecoveryNotice,
        setConnectionRecoveryStatus,
        connectionRecoveryStagedRevision,
        selectedSprint,
        availableSprints,
        sprintsLoading,
        groupsLoading,
        activeGroupId,
        showScenario,
        pendingShellAuthResumeRef,
        selectedSprintInfo,
        trackScenarioAction,
        visibleControlGroups,
        selectedSprintState,
        isCompletedSprintSelected,
        registerSprintFetch,
        cleanupSprintFetch,
        activeGroup,
        teamOptions,
        selectedTeamSet,
        isAllTeamsSelected,
        excludedEpicSet,
    });

    const {
        acquireScenarioIssueLock,
        refreshScenarioIssueLock,
        releaseScenarioIssueLock,
        scenarioRemoteEditors,
        scenarioIssueLockWarnings,
    } = useScenarioRealtime({
        scenarioState,
        BACKEND_URL,
        pauseScenarioRealtime,
        postScenarioRealtimeJson,
        pollScenarioDraftEvents,
        scenarioScopeKey,
        scenarioActiveDraftId,
        scenarioActiveDraftReady,
    });

    const {
        scenarioSummary,
        scenarioBaseUrl,
        scenarioDependencies,
        scenarioCapacityByTeam,
        scenarioIssues,
        scenarioSearchQuery,
        scenarioSearchMatchSet,
        scenarioExcludedIssueKeys,
        scenarioFocusSet,
        scenarioContextSet,
        scenarioIssueByKey,
        scenarioDeadline,
        scenarioViewStart,
        scenarioViewEnd,
        scenarioFocusIssueKeys,
        scenarioFocusContextKeys,
        scenarioTimelineIssues,
        scenarioTimelineWithSegments,
        scenarioTimelineIssueKeys,
        scenarioAssigneeConflicts,
        scenarioDepViolations,
        scenarioDepViolatedKeys,
    } = useScenarioDerived({
        scenarioState,
        EMPTY_ARRAY,
        EMPTY_OBJECT,
        jiraUrl,
        searchQuery,
        normalizeEpicKey,
        excludedEpicSet,
    });

    // --- Drag effect, undo/redo, save/discard (placed after scenarioViewStart/End & scenarioIssueByKey) ---

    const {
        toggleScenarioEditMode,
        handleScenarioBarMouseDown,
        scenarioUndo,
        scenarioRedo,
        scenarioOverrideCount,
    } = useScenarioDrag({
        scenarioState,
        trackScenarioAction,
        scenarioHasUnsavedChanges,
        acquireScenarioIssueLock,
        refreshScenarioIssueLock,
        releaseScenarioIssueLock,
        scenarioIssueByKey,
    });

    const {
        saveScenarioDraft,
        discardScenarioOverrides,
        openScenarioDraftHistory,
        closeScenarioDraftHistory,
        requestReloadActiveDraft,
        cancelReloadActiveDraft,
        runReloadActiveDraft,
        requestScenarioHistoryAction,
        cancelScenarioHistoryAction,
        requestScenarioReloadFromJira,
        cancelScenarioReloadFromJira,
        runScenarioReloadFromJira,
        previewScenarioDraftWriteback,
        checkScenarioDraftWritebackGate,
        runScenarioHistoryAction,
    } = useScenarioHistory({
        scenarioState,
        trackScenarioAction,
        fetchScenarioDraft,
        postScenarioRealtimeJson,
        saveScenarioDraftVersion,
        fetchScenarioDraftVersion,
        rollbackScenarioDraft,
        reloadScenarioDraftFromJira,
        buildScenarioDraftScope,
        scenarioScopeKey,
        scenarioHasUnsavedChanges,
        scenarioCanSaveDraft,
        isScenarioScopeDraftCurrent,
    });

    const scenarioLaneForIssue = (issue) => {
        if (scenarioEpicFocus?.key) {
            return scenarioEpicFocus.key;
        }
        if (scenarioLaneMode === 'epic') {
            return issue.epicKey || 'No Epic';
        }
        if (scenarioLaneMode === 'assignee') {
            return issue.assignee || 'Unassigned';
        }
        return issue.team || 'Unassigned';
    };
    const scenarioLaneInfo = React.useMemo(() => {
        const info = new Map();
        if (!scenarioTimelineIssues || scenarioTimelineIssues.length === 0) {
            if (scenarioEpicFocus?.key) {
                info.set(scenarioEpicFocus.key, {
                    label: scenarioEpicFocus.summary || scenarioEpicFocus.key,
                    key: scenarioEpicFocus.key,
                    totalSp: 0,
                    lateCount: 0,
                    unschedulableCount: 0,
                    conflictCount: 0,
                    capacity: null
                });
            }
            return info;
        }
        scenarioTimelineIssues.forEach(issue => {
            const lane = scenarioLaneForIssue(issue);
            const current = info.get(lane) || {
                label: lane,
                key: lane,
                totalSp: 0,
                lateCount: 0,
                unschedulableCount: 0,
                conflictCount: 0,
                capacity: null
            };
            const countIssue = !scenarioEpicFocus || scenarioFocusIssueKeys.has(issue.key);
            const isExcluded = scenarioExcludedIssueKeys.has(issue.key);
            if (countIssue) {
                current.totalSp += Number(issue.sp || 0);
                if (!isExcluded && (!issue.start || !issue.end)) {
                    current.unschedulableCount += 1;
                }
                if (!isExcluded && issue.isLate) {
                    current.lateCount += 1;
                }
                if (!isExcluded && scenarioAssigneeConflicts.conflicts.has(issue.key)) {
                    current.conflictCount += 1;
                }
            }
            if (scenarioLaneMode === 'epic') {
                current.key = issue.epicKey || 'No Epic';
                current.label = issue.epicSummary || issue.epicKey || 'No Epic';
            }
            if (scenarioLaneMode === 'team') {
                const capacity = scenarioCapacityByTeam[issue.team || '']?.size;
                current.capacity = capacity ?? current.capacity;
            }
            info.set(lane, current);
        });
        if (scenarioEpicFocus?.key) {
            const existing = info.get(scenarioEpicFocus.key) || {
                label: scenarioEpicFocus.key,
                key: scenarioEpicFocus.key,
                totalSp: 0,
                lateCount: 0,
                unschedulableCount: 0,
                conflictCount: 0,
                capacity: null
            };
            existing.label = scenarioEpicFocus.summary || scenarioEpicFocus.key;
            existing.key = scenarioEpicFocus.key;
            info.set(scenarioEpicFocus.key, existing);
        }
        return info;
    }, [scenarioTimelineIssues, scenarioLaneMode, scenarioCapacityByTeam, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioExcludedIssueKeys, scenarioAssigneeConflicts]);
    const scenarioSearchFilterEnabled = Boolean(scenarioSearchQuery && !scenarioEpicFocus);
    const scenarioLateItems = React.useMemo(() => {
        return (scenarioSummary.late_items || []).filter(key => (
            !scenarioExcludedIssueKeys.has(key)
            && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
        ));
    }, [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]);
    const scenarioDeadlineAtRisk = scenarioLateItems.length > 0;
    const scenarioCriticalPathItems = React.useMemo(() => {
        return (scenarioSummary.critical_path || []).filter(key => (
            !scenarioExcludedIssueKeys.has(key)
            && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
        ));
    }, [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]);
    const scenarioUnschedulableItems = React.useMemo(() => {
        return (scenarioSummary.unschedulable || []).filter(key => (
            !scenarioExcludedIssueKeys.has(key)
            && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
        ));
    }, [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]);
    const scenarioLanes = React.useMemo(() => {
        const lanes = Array.from(scenarioLaneInfo.keys());
        return lanes.sort((a, b) => a.localeCompare(b));
    }, [scenarioLaneInfo]);
    const scenarioIssuesByLane = React.useMemo(() => {
        return buildLaneIssues(scenarioTimelineWithSegments, scenarioLaneMode, scenarioLaneForIssue);
    }, [scenarioTimelineWithSegments, scenarioLaneMode, scenarioEpicFocus]);
    const scenarioTicks = React.useMemo(() => {
        if (!scenarioViewStart || !scenarioViewEnd) return [];
        const ticks = [];
        const start = new Date(scenarioViewStart.getTime());
        const end = new Date(scenarioViewEnd.getTime());

        // Generate ticks for each quarter boundary
        const startQuarter = Math.floor(start.getMonth() / 3);
        let quarterStart = new Date(start.getFullYear(), startQuarter * 3, 1);

        // If view starts mid-quarter, begin at next quarter
        if (quarterStart < start) {
            const nextQuarter = startQuarter + 1;
            const year = start.getFullYear() + Math.floor(nextQuarter / 4);
            const month = (nextQuarter % 4) * 3;
            quarterStart = new Date(year, month, 1);
        }

        let cursor = quarterStart;
        const totalMs = Math.max(1, end - start);

        while (cursor <= end) {
            const ratio = (cursor - start) / totalMs;
            if (ratio >= 0 && ratio <= 1) {
                const quarter = Math.floor(cursor.getMonth() / 3) + 1;
                const yearShort = String(cursor.getFullYear()).slice(-2);
                ticks.push({
                    label: `Q${quarter}'${yearShort}`,
                    ratio
                });
            }
            const nextMonth = cursor.getMonth() + 3;
            cursor = new Date(cursor.getFullYear() + Math.floor(nextMonth / 12), nextMonth % 12, 1);
        }

        return ticks;
    }, [scenarioViewStart, scenarioViewEnd]);
    const scenarioQuarterMarkers = React.useMemo(() => {
        if (!scenarioViewStart || !scenarioViewEnd) return [];
        const markers = [];
        const start = new Date(scenarioViewStart.getTime());
        const end = new Date(scenarioViewEnd.getTime());
        const startQuarter = Math.floor(start.getMonth() / 3);
        let quarterStart = new Date(start.getFullYear(), startQuarter * 3, 1);
        if (quarterStart < start) {
            const nextQuarter = startQuarter + 1;
            const year = start.getFullYear() + Math.floor(nextQuarter / 4);
            const month = (nextQuarter % 4) * 3;
            quarterStart = new Date(year, month, 1);
        }
        let cursor = quarterStart;
        const deadlineDate = scenarioDeadline ? new Date(scenarioDeadline.getTime()) : null;
        while (cursor <= end) {
            const ratio = (cursor - scenarioViewStart) / Math.max(1, scenarioViewEnd - scenarioViewStart);
            // Skip marker if it's the same as the deadline (avoid duplicate lines)
            const isDuplicateDeadline = deadlineDate &&
                cursor.getFullYear() === deadlineDate.getFullYear() &&
                cursor.getMonth() === deadlineDate.getMonth() &&
                cursor.getDate() === deadlineDate.getDate();

            if (ratio >= 0 && ratio <= 1 && !isDuplicateDeadline) {
                markers.push({
                    date: new Date(cursor.getTime()),
                    ratio
                });
            }
            const nextMonth = cursor.getMonth() + 3;
            cursor = new Date(cursor.getFullYear() + Math.floor(nextMonth / 12), nextMonth % 12, 1);
        }
        return markers;
    }, [scenarioViewStart, scenarioViewEnd, scenarioDeadline]);
    const SCENARIO_LANE_HEIGHT = 52;
    const scenarioBarGap = scenarioEpicFocus ? 16 : SCENARIO_BAR_GAP;
    const scenarioLaneStacking = React.useMemo(() => {
        // Early return if no lanes to process
        if (!scenarioLanes || scenarioLanes.length === 0) {
            return {
                rowIndexByKey: new Map(),
                laneRowCounts: new Map(),
                laneVisibleRows: new Map(),
                laneHiddenCounts: new Map(),
                laneRowAssignees: new Map()
            };
        }

        if (perfEnabled) {
            perfCountersRef.current.laneStacking += 1;
            performance.mark('scenarioLaneStacking:start');
        }
        const rowIndexByKey = new Map();
        const laneRowCounts = new Map();
        const laneVisibleRows = new Map();
        const laneHiddenCounts = new Map();
        const laneRowAssignees = new Map();
        const fallbackStart = scenarioViewStart || new Date(0);
        const DAY_MS = 24 * 60 * 60 * 1000;
        const assignRows = (issueList, rowEnds, baseOffset, rowAssignees, options = {}) => {
            const allowNewRows = options.allowNewRows !== false;
            const allowAssigneeMix = options.allowAssigneeMix === true;
            issueList.forEach((issue) => {
                if (!issue?.key) return;
                const assignee = issue.assignee || null;
                const isUnscheduled = !issue.start || !issue.end;
                const start = parseScenarioDate(issue.start) || fallbackStart;
                const end = parseScenarioDate(issue.end) || start;
                // Ensure every task occupies at least 1 day so bars never visually overlap
                const rawEnd = end < start ? start : end;
                const normalizedEnd = rawEnd <= start
                    ? new Date(start.getTime() + DAY_MS)
                    : rawEnd;

                // Find a row where:
                // 1. Time is available (start >= rowEnd)
                // 2. Row either has no assignee yet, OR has the same assignee
                let rowIndex = rowEnds.findIndex((rowEnd, idx) => {
                    const timeAvailable = start > rowEnd;
                    const rowAssignee = rowAssignees[idx];
                    const assigneeMatch = allowAssigneeMix || !rowAssignee || rowAssignee === assignee;
                    return timeAvailable && assigneeMatch;
                });

                if (rowIndex === -1) {
                    if (!allowNewRows) return;
                    // No suitable row found, create new one
                    rowIndex = rowEnds.length;
                    rowEnds.push(normalizedEnd);
                    rowAssignees[rowIndex] = assignee;
                } else {
                    // Update existing row
                    rowEnds[rowIndex] = normalizedEnd;
                    // Keep the assignee if row already had one, or set it if it was empty
                    if (!rowAssignees[rowIndex]) {
                        rowAssignees[rowIndex] = assignee;
                    }
                }
                rowIndexByKey.set(issue.key, baseOffset + rowIndex);
            });
        };
        scenarioLanes.forEach((lane) => {
            const issues = scenarioIssuesByLane.get(lane) || [];
            const rowEnds = [];
            const rowAssignees = []; // Track which assignee is on each row
            const capacitySize = scenarioLaneMode === 'team'
                ? Number(scenarioCapacityByTeam[lane || '']?.size)
                : null;
            const capacityRows = Number.isFinite(capacitySize) && capacitySize > 0
                ? Math.max(1, Math.round(capacitySize) + SCENARIO_TEAM_LEAD_ROWS)
                : null;
            const regularIssues = [];
            const rawCapacityIssues = [];
            issues.forEach((issue) => {
                if (!issue?.key) return;
                const issueKeyForExclude = issue.originalKey || issue.key;
                if (scenarioExcludedIssueKeys.has(issueKeyForExclude) || excludedEpicSet.has(normalizeEpicKey(issue.epicKey || ''))) {
                    rawCapacityIssues.push(issue);
                } else {
                    regularIssues.push(issue);
                }
            });
            // Regular tasks fill top rows; excluded capacity always goes
            // below all regular rows (never shares a row with regular tasks).
            // Excluded dates are already clipped to the sprint in
            // scenarioTimelineWithSegments.
            assignRows(regularIssues, rowEnds, 0, rowAssignees);
            if (rawCapacityIssues.length > 0) {
                const excludedRowStart = Math.max(1, rowEnds.length);
                const excludedRowEnds = [];
                const excludedRowAssignees = [];
                assignRows(rawCapacityIssues, excludedRowEnds, excludedRowStart, excludedRowAssignees, { allowAssigneeMix: true });
                excludedRowEnds.forEach(end => rowEnds.push(end));
                excludedRowAssignees.forEach(a => rowAssignees.push(a));
            }
            laneRowAssignees.set(lane, [...rowAssignees]);
            const totalRows = Math.max(1, rowEnds.length, capacityRows || 0);
            const isCollapsed = scenarioEpicFocus ? false : Boolean(scenarioCollapsedLanes[lane]);
            const collapsedRows = scenarioLaneMode === 'epic'
                ? 1
                : (scenarioLaneMode === 'team' && capacityRows
                    ? Math.max(SCENARIO_COLLAPSED_ROWS, capacityRows)
                    : SCENARIO_COLLAPSED_ROWS);
            const visibleRows = isCollapsed
                ? Math.min(collapsedRows, totalRows)
                : totalRows;
            laneRowCounts.set(lane, totalRows);
            laneVisibleRows.set(lane, Math.max(1, visibleRows));
            laneHiddenCounts.set(lane, Math.max(0, totalRows - visibleRows));
        });
        if (perfEnabled) {
            performance.mark('scenarioLaneStacking:end');
            performance.measure(
                'scenarioLaneStacking',
                'scenarioLaneStacking:start',
                'scenarioLaneStacking:end'
            );
            performance.clearMarks('scenarioLaneStacking:start');
            performance.clearMarks('scenarioLaneStacking:end');
            performance.clearMeasures('scenarioLaneStacking');
        }
        return { rowIndexByKey, laneRowCounts, laneVisibleRows, laneHiddenCounts, laneRowAssignees };
    }, [
        scenarioLanes,
        scenarioIssuesByLane,
        scenarioViewStart,
        scenarioCollapsedLanes,
        scenarioLaneMode,
        scenarioCapacityByTeam,
        scenarioExcludedIssueKeys,
        isAllTeamsSelected,
        scenarioEpicFocus,
        perfEnabled
    ]);
    const scenarioVisibleExportIssues = React.useMemo(() => {
        if (!scenarioTimelineWithSegments || scenarioTimelineWithSegments.length === 0) return [];
        return scenarioTimelineWithSegments.filter(issue => {
            if (!issue?.key) return false;
            if (scenarioShowConflictsOnly && !scenarioAssigneeConflicts.conflicts.has(issue.key)) return false;
            const lane = scenarioLaneForIssue(issue);
            const rowIndex = scenarioLaneStacking.rowIndexByKey.get(issue.key) ?? 0;
            const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
            return rowIndex < visibleRows;
        });
    }, [
        scenarioTimelineWithSegments,
        scenarioShowConflictsOnly,
        scenarioAssigneeConflicts,
        scenarioLaneStacking,
        scenarioLaneMode,
        scenarioEpicFocus
    ]);
    const scenarioJiraEpicKeys = React.useMemo(
        () => collectJiraExportKeysFromScenarioIssues(scenarioVisibleExportIssues, 'epics'),
        [scenarioVisibleExportIssues]
    );
    const scenarioJiraStoryKeys = React.useMemo(
        () => collectJiraExportKeysFromScenarioIssues(scenarioVisibleExportIssues, 'stories'),
        [scenarioVisibleExportIssues]
    );
    const scenarioLaneMeta = React.useMemo(() => {
        const meta = new Map();
        let offset = 0;
        scenarioLanes.forEach((lane) => {
            const totalRows = scenarioLaneStacking.laneRowCounts.get(lane) || 1;
            const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
            const hiddenCount = scenarioLaneStacking.laneHiddenCounts.get(lane) || 0;
            const shouldCollapse = Boolean(scenarioCollapsedLanes[lane]);
            const isCollapsed = scenarioEpicFocus?.key === lane ? false : shouldCollapse;
            const rowCount = Math.max(1, visibleRows);
            const height = rowCount * (SCENARIO_BAR_HEIGHT + scenarioBarGap) + scenarioBarGap;
            meta.set(lane, { offset, height, rowCount, collapsed: isCollapsed, hiddenCount, totalRows });
            offset += height;
        });
        return { meta, totalHeight: offset };
    }, [scenarioLanes, scenarioLaneStacking, scenarioCollapsedLanes, scenarioEpicFocus, scenarioBarGap]);
    const scenarioLaneAssigneeGroups = React.useMemo(() => {
        if (scenarioLaneMode !== 'team') return new Map();
        const result = new Map();
        scenarioLanes.forEach((lane) => {
            const rowAssignees = scenarioLaneStacking.laneRowAssignees?.get(lane) || [];
            const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
            const groups = [];
            let current = null;
            for (let i = 0; i < Math.min(rowAssignees.length, visibleRows); i++) {
                const assignee = rowAssignees[i] || null;
                if (current && current.assignee === assignee) {
                    current.rowCount += 1;
                } else {
                    current = { assignee, startRow: i, rowCount: 1 };
                    groups.push(current);
                }
            }
            result.set(lane, groups);
        });
        return result;
    }, [scenarioLaneMode, scenarioLanes, scenarioLaneStacking]);
    const areScenarioCollapsedLanesEqual = (a, b) => {
        if (a === b) return true;
        const aKeys = Object.keys(a || {});
        const bKeys = Object.keys(b || {});
        if (aKeys.length !== bKeys.length) return false;
        for (let i = 0; i < aKeys.length; i += 1) {
            const key = aKeys[i];
            if (a[key] !== b[key]) return false;
        }
        return true;
    };

    useEffect(() => {
        if (!showScenario) return;
        if (!scenarioIssues.length && !scenarioLanes.length) return;
        if (scenarioSkipAutoCollapseRef.current) {
            scenarioSkipAutoCollapseRef.current = false;
            return;
        }
        if (scenarioLaneMode === 'team' && isAllTeamsSelected) {
            if (!scenarioTeamCollapseInitRef.current) {
                const next = {};
                scenarioLanes.forEach(lane => {
                    next[lane] = true;
                });
                setScenarioCollapsedLanes(prev => (areScenarioCollapsedLanesEqual(prev, next) ? prev : next));
                scenarioTeamCollapseInitRef.current = true;
            }
            return;
        }
        scenarioTeamCollapseInitRef.current = false;
        if (scenarioLaneMode !== 'epic') {
            setScenarioCollapsedLanes(prev => (Object.keys(prev || {}).length ? {} : prev));
            return;
        }
        const next = {};
        scenarioLanes.forEach(lane => {
            next[lane] = true;
        });
        scenarioIssues.forEach(issue => {
            if (scenarioFocusSet.size === 0 || scenarioFocusSet.has(issue.key) || scenarioContextSet.has(issue.key)) {
                next[scenarioLaneForIssue(issue)] = false;
            }
        });
        setScenarioCollapsedLanes(prev => (areScenarioCollapsedLanesEqual(prev, next) ? prev : next));
    }, [
        showScenario,
        scenarioLaneMode,
        scenarioLanes,
        scenarioIssues,
        scenarioFocusSet,
        scenarioContextSet,
        isAllTeamsSelected
    ]);

    useEffect(() => {
        scenarioTeamCollapseInitRef.current = false;
    }, [scenarioData]);

    useEffect(() => {
        if (!showScenario || !scenarioTimelineRef.current) return;
        const container = scenarioTimelineRef.current;
        const readLayout = () => {
            if (perfEnabled) {
                perfCountersRef.current.layoutReads += 1;
            }
            const track = container.querySelector('.scenario-lane-track');
            const containerStyles = window.getComputedStyle(container);
            const labelWidthValue = parseFloat(containerStyles.getPropertyValue('--scenario-label-width')) || 190;
            const laneEl = container.querySelector('.scenario-lane');
            let gapValue = 0;
            if (laneEl) {
                const laneStyles = window.getComputedStyle(laneEl);
                gapValue = parseFloat(laneStyles.columnGap || laneStyles.gap || '0') || 0;
            }
            const labelWidth = labelWidthValue + gapValue;
            const trackWidth = track ? track.clientWidth : Math.max(0, container.clientWidth - labelWidth);
            let height = scenarioLaneMeta.totalHeight || scenarioLanes.length * SCENARIO_LANE_HEIGHT;
            setScenarioLayout(prev => {
                if (prev.width === trackWidth && prev.height === height && prev.labelWidth === labelWidth) {
                    return prev;
                }
                return {
                    width: trackWidth,
                    height,
                    labelWidth
                };
            });
            scheduleScenarioEdgeUpdate();
        };
        const readScroll = () => {
            if (perfEnabled) {
                perfCountersRef.current.scrollReads += 1;
            }
            const nextTop = container.scrollTop || 0;
            const nextLeft = container.scrollLeft || 0;
            const nextHeight = container.clientHeight || 0;
            setScenarioScrollTop(prev => (prev === nextTop ? prev : nextTop));
            setScenarioScrollLeft(prev => (prev === nextLeft ? prev : nextLeft));
            setScenarioViewportHeight(prev => (prev === nextHeight ? prev : nextHeight));
            scheduleScenarioEdgeUpdate();
        };
        const scheduleLayout = () => {
            if (scenarioResizeFrameRef.current) return;
            scenarioResizeFrameRef.current = window.requestAnimationFrame(() => {
                scenarioResizeFrameRef.current = null;
                if (!scenarioTimelineRef.current) return;
                readLayout();
            });
        };
        const scheduleScroll = () => {
            if (scenarioScrollFrameRef.current) return;
            scenarioScrollFrameRef.current = window.requestAnimationFrame(() => {
                scenarioScrollFrameRef.current = null;
                if (!scenarioTimelineRef.current) return;
                readScroll();
            });
        };
        scheduleLayout();
        scheduleScroll();
        container.addEventListener('scroll', scheduleScroll, { passive: true });
        window.addEventListener('resize', scheduleLayout);
        window.addEventListener('resize', scheduleScroll);
        return () => {
            container.removeEventListener('scroll', scheduleScroll);
            window.removeEventListener('resize', scheduleLayout);
            window.removeEventListener('resize', scheduleScroll);
            if (scenarioScrollFrameRef.current) {
                window.cancelAnimationFrame(scenarioScrollFrameRef.current);
                scenarioScrollFrameRef.current = null;
            }
            if (scenarioResizeFrameRef.current) {
                window.cancelAnimationFrame(scenarioResizeFrameRef.current);
                scenarioResizeFrameRef.current = null;
            }
        };
    }, [showScenario, scenarioLanes.length, scenarioData, scenarioLaneMode, scenarioIssuesByLane, scenarioLaneMeta, scheduleScenarioEdgeUpdate, perfEnabled]);

    const scenarioPositions = React.useMemo(() => {
        if (!scenarioViewStart || !scenarioViewEnd) return {};
        if (!scenarioLayout.width) return {};
        const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
        const positions = {};

        // Debug: Log Accepted tasks positioning to diagnose left-of-TODAY bug
        if (process.env.NODE_ENV === 'development') {
            const acceptedTasks = scenarioTimelineIssues.filter(i => i.status === 'Accepted');
            if (acceptedTasks.length > 0) {
                console.debug('[Scenario] Accepted tasks:', acceptedTasks.map(i => ({
                    key: i.key,
                    start: i.start,
                    end: i.end,
                    scheduledReason: i.scheduledReason
                })));
                console.debug('[Scenario] View range:', {
                    start: scenarioViewStart,
                    end: scenarioViewEnd,
                    today: new Date()
                });
            }
        }

        scenarioTimelineWithSegments.forEach((issue) => {
            const lane = scenarioLaneForIssue(issue);
            const laneMeta = scenarioLaneMeta.meta.get(lane);
            if (!laneMeta) return;
            const rowIndex = scenarioLaneStacking.rowIndexByKey.get(issue.key) ?? 0;
            const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
            if (rowIndex >= visibleRows) return;
            const y = laneMeta.offset + scenarioBarGap + rowIndex * (SCENARIO_BAR_HEIGHT + scenarioBarGap);
            if (!issue.start || !issue.end) {
                const width = Math.min(80, scenarioLayout.width * 0.12);
                positions[issue.key] = {
                    xStart: 0,
                    xEnd: width,
                    y,
                    height: SCENARIO_BAR_HEIGHT,
                    lane
                };
                return;
            }
            const start = parseScenarioDate(issue.start);
            const end = parseScenarioDate(issue.end);
            if (!start || !end) return;
            const startRatio = Math.max(0, (start - scenarioViewStart) / totalMs);
            const endRatio = Math.min(1, (end - scenarioViewStart) / totalMs);
            const xStart = startRatio * scenarioLayout.width;
            const xEnd = Math.max(xStart + 6, endRatio * scenarioLayout.width);
            positions[issue.key] = {
                xStart,
                xEnd,
                y,
                height: SCENARIO_BAR_HEIGHT,
                lane
            };
        });
        return positions;
    }, [
        scenarioTimelineWithSegments,
        scenarioViewStart,
        scenarioViewEnd,
        scenarioLayout,
        scenarioLanes,
        scenarioLaneMeta,
        scenarioBarGap,
        scenarioLaneStacking
    ]);

    const scenarioEdgeCandidates = React.useMemo(() => {
        return (scenarioDependencies || []).filter(edge =>
            edge?.from &&
            edge?.to &&
            scenarioTimelineIssueKeys.has(edge.from) &&
            scenarioTimelineIssueKeys.has(edge.to)
        );
    }, [scenarioDependencies, scenarioTimelineIssueKeys]);

    const scenarioEdgeIndex = React.useMemo(() => {
        const incoming = new Map();
        const outgoing = new Map();
        scenarioEdgeCandidates.forEach(edge => {
            if (!incoming.has(edge.to)) {
                incoming.set(edge.to, new Set());
            }
            if (!outgoing.has(edge.from)) {
                outgoing.set(edge.from, new Set());
            }
            incoming.get(edge.to).add(edge.from);
            outgoing.get(edge.from).add(edge.to);
        });
        return { incoming, outgoing };
    }, [scenarioEdgeCandidates]);

    const scenarioEpicBars = React.useMemo(() => {
        if (scenarioLaneMode !== 'epic') return [];
        if (!scenarioViewStart || !scenarioViewEnd) return [];
        const bars = [];
        const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
        scenarioLanes.forEach((lane) => {
            const laneIssues = scenarioIssuesByLane.get(lane) || [];
            const epicGroups = new Map();
            laneIssues.forEach((issue) => {
                const epicKey = issue.epicKey;
                if (!epicKey) return;
                if (!epicGroups.has(epicKey)) {
                    epicGroups.set(epicKey, []);
                }
                epicGroups.get(epicKey).push(issue);
            });
            epicGroups.forEach((issues, epicKey) => {
                if (scenarioEpicFocus?.key && epicKey !== scenarioEpicFocus.key) return;
                let start = null;
                let end = null;
                let storyPoints = 0;
                const assigneeSet = new Set();
                issues.forEach((issue) => {
                    const startDate = parseScenarioDate(issue.start);
                    const endDate = parseScenarioDate(issue.end);
                    if (!startDate || !endDate) return;
                    if (!start || startDate < start) start = startDate;
                    if (!end || endDate > end) end = endDate;
                    if (Number.isFinite(issue.sp)) {
                        storyPoints += Number(issue.sp);
                    }
                    if (issue.assignee) {
                        assigneeSet.add(issue.assignee);
                    }
                });
                if (!start || !end) return;
                const startRatio = Math.max(0, (start - scenarioViewStart) / totalMs);
                const endRatio = Math.min(1, (end - scenarioViewStart) / totalMs);
                const xStart = startRatio * scenarioLayout.width;
                const xEnd = Math.max(xStart + 6, endRatio * scenarioLayout.width);
                const laneMeta = scenarioLaneMeta.meta.get(lane) || { offset: 0, height: SCENARIO_LANE_HEIGHT };
                const assignees = Array.from(assigneeSet);
                bars.push({
                    lane,
                    epicKey,
                    epicSummary: scenarioIssueByKey.get(issues[0].key)?.epicSummary,
                    storyPoints,
                    assignees,
                    xStart,
                    xEnd,
                    y: laneMeta.offset + 3,
                    height: laneMeta.height - 6,
                    isExcluded: excludedEpicSet.has(normalizeEpicKey(epicKey))
                });
            });
        });
        return bars;
    }, [scenarioIssuesByLane, scenarioLanes, scenarioLaneMode, scenarioViewStart, scenarioViewEnd, scenarioLayout, scenarioLaneMeta, scenarioIssueByKey, scenarioEpicFocus, excludedEpicSet]);

    const scenarioEpicEdges = React.useMemo(() => {
        if (scenarioLaneMode !== 'epic' || scenarioEpicFocus) return [];
        const grouped = new Map();
        (scenarioDependencies || []).forEach(edge => {
            const fromIssue = scenarioIssueByKey.get(edge.from);
            const toIssue = scenarioIssueByKey.get(edge.to);
            if (!fromIssue || !toIssue) return;
            const fromEpic = fromIssue.epicKey || 'No Epic';
            const toEpic = toIssue.epicKey || 'No Epic';
            if (fromEpic === toEpic) return;
            const key = `${fromEpic}::${toEpic}`;
            const current = grouped.get(key) || { fromEpic, toEpic, count: 0 };
            current.count += 1;
            grouped.set(key, current);
        });
        const edges = [];
        grouped.forEach((entry) => {
            const fromMeta = scenarioLaneMeta.meta.get(entry.fromEpic);
            const toMeta = scenarioLaneMeta.meta.get(entry.toEpic);
            if (!fromMeta || !toMeta) return;
            edges.push({
                fromEpic: entry.fromEpic,
                toEpic: entry.toEpic,
                count: entry.count,
                y1: fromMeta.offset + fromMeta.height / 2,
                y2: toMeta.offset + toMeta.height / 2,
            });
        });
        return edges;
    }, [scenarioDependencies, scenarioLaneMeta, scenarioLaneMode, scenarioIssueByKey]);


    const scenarioTodayLeft = React.useMemo(() => {
        if (!scenarioViewStart || !scenarioViewEnd) return null;
        if (!scenarioLayout.width) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today
        const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
        const ratio = (today - scenarioViewStart) / totalMs;
        // Only show if today is within the visible range
        if (ratio < 0 || ratio > 1) return null;
        return scenarioLayout.labelWidth + scenarioLayout.width * ratio;
    }, [scenarioViewStart, scenarioViewEnd, scenarioLayout]);

    const scenarioVisibleLanes = React.useMemo(() => {
        if (!scenarioViewportHeight) return scenarioLanes;
        const buffer = 80;
        const start = scenarioScrollTop - buffer;
        const end = scenarioScrollTop + scenarioViewportHeight + buffer;
        return scenarioLanes.filter(lane => {
            const meta = scenarioLaneMeta.meta.get(lane);
            if (!meta) return false;
            return meta.offset + meta.height >= start && meta.offset <= end;
        });
    }, [scenarioLanes, scenarioLaneMeta, scenarioScrollTop, scenarioViewportHeight]);

    const scenarioActiveEdges = React.useMemo(() => {
        if (!scenarioHoverKey) return [];
        return scenarioEdgeCandidates.filter(edge => edge.from === scenarioHoverKey || edge.to === scenarioHoverKey);
    }, [scenarioEdgeCandidates, scenarioHoverKey]);

    const scenarioUpstreamSet = React.useMemo(() => {
        if (!scenarioHoverKey) return new Set();
        return new Set(scenarioEdgeIndex.incoming.get(scenarioHoverKey) || []);
    }, [scenarioHoverKey, scenarioEdgeIndex]);

    const scenarioDownstreamSet = React.useMemo(() => {
        if (!scenarioHoverKey) return new Set();
        return new Set(scenarioEdgeIndex.outgoing.get(scenarioHoverKey) || []);
    }, [scenarioHoverKey, scenarioEdgeIndex]);

    const scenarioBlockedSet = React.useMemo(() => {
        const blocked = new Set();
        (scenarioDependencies || []).forEach(edge => {
            if (edge.type === 'block' && edge.to) {
                blocked.add(edge.to);
            }
        });
        return blocked;
    }, [scenarioDependencies]);

    const scenarioBaselineEdges = React.useMemo(() => {
        return scenarioEdgeCandidates;
    }, [scenarioEdgeCandidates]);

    const scenarioFocusEdges = React.useMemo(() => {
        if (!scenarioEpicFocus) return [];
        const inside = [];
        const context = [];
        scenarioEdgeCandidates.forEach(edge => {
            const fromIn = scenarioFocusIssueKeys.has(edge.from);
            const toIn = scenarioFocusIssueKeys.has(edge.to);
            if (fromIn && toIn) {
                inside.push(edge);
                return;
            }
            const fromContext = scenarioFocusContextKeys.has(edge.from);
            const toContext = scenarioFocusContextKeys.has(edge.to);
            if ((fromIn && toContext) || (toIn && fromContext)) {
                context.push(edge);
            }
        });
        return [...context, ...inside];
    }, [scenarioEpicFocus, scenarioEdgeCandidates, scenarioFocusIssueKeys, scenarioFocusContextKeys]);

    const toggleScenarioLane = (lane) => {
        setScenarioCollapsedLanes(prev => ({
            ...prev,
            [lane]: !prev?.[lane]
        }));
    };


    const areScenarioEdgeRendersEqual = (prev, next) => {
        if (prev.width !== next.width || prev.height !== next.height) return false;
        if (prev.paths.length !== next.paths.length) return false;
        for (let i = 0; i < prev.paths.length; i += 1) {
            const a = prev.paths[i];
            const b = next.paths[i];
            if (a.id !== b.id) return false;
            if (a.d !== b.d) return false;
            if (a.isActive !== b.isActive) return false;
            if (a.isFaded !== b.isFaded) return false;
            if (a.isContextEdge !== b.isContextEdge) return false;
            if (a.type !== b.type) return false;
        }
        return true;
    };

    const computeScenarioTooltipPosition = (anchor) => {
        const fallback = { width: 240, height: 56 };
        const tooltipNode = scenarioTooltipRef.current;
        const measured = tooltipNode?.getBoundingClientRect?.();
        const tooltipWidth = measured?.width || fallback.width;
        const tooltipHeight = measured?.height || fallback.height;
        const rect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
        if (!rect) {
            return { x: 0, y: 0 };
        }
        const padding = 12;
        const offset = 10;
        let x = rect.right + offset;
        let y = rect.top - tooltipHeight - offset;
        if (y < padding) {
            y = rect.bottom + offset;
        }
        if (x + tooltipWidth > window.innerWidth - padding) {
            x = rect.left - tooltipWidth - offset;
        }
        if (x < padding) {
            x = padding;
        }
        if (y + tooltipHeight > window.innerHeight - padding) {
            y = Math.max(padding, window.innerHeight - padding - tooltipHeight);
        }
        return { x, y };
    };

    const showScenarioTooltip = (event, payload) => {
        if (!payload) return;
        const anchor = event?.currentTarget;
        scenarioTooltipAnchorRef.current = anchor || null;
        const anchorRect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
        const position = computeScenarioTooltipPosition(anchorRect || {
            left: event.clientX,
            right: event.clientX,
            top: event.clientY,
            bottom: event.clientY,
            width: 0,
            height: 0
        });
        setScenarioTooltip({
            ...payload,
            visible: true,
            x: position.x,
            y: position.y
        });
    };

    const showScenarioTooltipFromElement = (element, payload) => {
        if (!element || !payload) return;
        scenarioTooltipAnchorRef.current = element;
        const rect = element.getBoundingClientRect();
        const position = computeScenarioTooltipPosition(rect);
        setScenarioTooltip({
            ...payload,
            visible: true,
            x: position.x,
            y: position.y
        });
    };

    const moveScenarioTooltip = () => {
        const anchor = scenarioTooltipAnchorRef.current;
        if (!anchor) return;
        setScenarioTooltip(prev => {
            if (!prev.visible) return prev;
            const position = computeScenarioTooltipPosition(anchor);
            if (position.x === prev.x && position.y === prev.y) return prev;
            return {
                ...prev,
                x: position.x,
                y: position.y
            };
        });
    };

    const hideScenarioTooltip = () => {
        scenarioTooltipAnchorRef.current = null;
        setScenarioTooltip(prev => (prev.visible ? { ...prev, visible: false } : prev));
    };

    const computeScenarioEdgePaths = React.useCallback(() => {
        if (perfEnabled) {
            perfCountersRef.current.edgeComputes += 1;
            performance.mark('scenarioEdgeCompute:start');
        }
        const container = scenarioTimelineRef.current;
        if (!container) {
            return { width: 0, height: 0, paths: [] };
        }
        const containerRect = container.getBoundingClientRect();
        const scrollLeft = container.scrollLeft || 0;
        const scrollTop = container.scrollTop || 0;
        const visibleRects = new Map();
        const visibleKeys = new Set();
        scenarioIssueRefMap.current.forEach((node, key) => {
            if (!node || !node.getBoundingClientRect) return;
            const rect = node.getBoundingClientRect();
            visibleRects.set(key, {
                x: rect.left - containerRect.left + scrollLeft,
                y: rect.top - containerRect.top + scrollTop,
                width: rect.width,
                height: rect.height
            });
            visibleKeys.add(key);
        });

        const lanes = container.querySelector('.scenario-lanes');
        const track = container.querySelector('.scenario-lane-track');
        const lanesRect = lanes ? lanes.getBoundingClientRect() : null;
        const trackRect = track ? track.getBoundingClientRect() : null;
        const lanesTop = lanesRect ? lanesRect.top - containerRect.top + scrollTop : 0;
        const trackLeft = trackRect ? trackRect.left - containerRect.left + scrollLeft : (scenarioLayout.labelWidth || 0);

        const getFallbackRect = (issueKey) => {
            const pos = scenarioPositions[issueKey];
            if (!pos) return null;
            return {
                x: trackLeft + pos.xStart,
                y: lanesTop + pos.y,
                width: Math.max(2, pos.xEnd - pos.xStart),
                height: pos.height
            };
        };

        const baseEdges = scenarioHoverKey
            ? (scenarioEpicFocus ? scenarioFocusEdges : scenarioEdgeCandidates)
            : (scenarioEpicFocus ? scenarioFocusEdges : scenarioBaselineEdges);
        const edgeMap = new Map();
        baseEdges.forEach(edge => {
            edgeMap.set(`${edge.from}-${edge.to}-${edge.type || 'link'}`, edge);
        });
        if (scenarioHoverKey) {
            scenarioActiveEdges.forEach(edge => {
                edgeMap.set(`${edge.from}-${edge.to}-${edge.type || 'link'}`, edge);
            });
        }

        const paths = [];
        edgeMap.forEach((edge) => {
            const fromVisible = visibleKeys.has(edge.from);
            const toVisible = visibleKeys.has(edge.to);
            if (!fromVisible && !toVisible) return;
            const fromRect = visibleRects.get(edge.from) || getFallbackRect(edge.from);
            const toRect = visibleRects.get(edge.to) || getFallbackRect(edge.to);
            // Active Sprint anchor + dependency visualization: Edges must never render when endpoints are missing
            // This prevents edges from "shooting to the end" or landing on wrong bar positions
            if (!fromRect || !toRect) {
                if (process.env.NODE_ENV === 'development') {
                    console.debug(`[Scenario] Skipped edge ${edge.from} → ${edge.to}: missing rect`, {
                        fromRect: !!fromRect,
                        toRect: !!toRect,
                        fromInPositions: !!scenarioPositions[edge.from],
                        toInPositions: !!scenarioPositions[edge.to]
                    });
                }
                return;
            }
            const fromInFocus = scenarioEpicFocus && scenarioFocusIssueKeys.has(edge.from);
            const toInFocus = scenarioEpicFocus && scenarioFocusIssueKeys.has(edge.to);
            if (scenarioEpicFocus && !fromInFocus && !toInFocus) {
                return;
            }

            const startX = fromRect.x + fromRect.width;
            const endX = toRect.x;

            // Timeline dependency waterflow: Only show edges that flow forward in time
            // On a timeline, backward arrows (right-to-left) make no sense
            // Skip edges where prerequisite is scheduled AFTER dependent (backward in time)
            if (endX <= startX) {
                // Dependent is to the LEFT of or same position as prerequisite (backward/parallel)
                // This happens with circular dependencies in Jira data
                // Skip to avoid visual clutter and maintain left-to-right waterflow
                if (process.env.NODE_ENV === 'development') {
                    console.debug(`[Scenario] Skipped backward edge ${edge.from} → ${edge.to}: endX=${endX.toFixed(0)} <= startX=${startX.toFixed(0)}`);
                }
                return;
            }
            const startY = fromRect.y + fromRect.height / 2;
            const endY = toRect.y + toRect.height / 2;
            const dx = endX - startX;
            let c1x;
            let c2x;
            if (dx >= 0) {
                const curve = Math.min(140, Math.max(20, dx * 0.5));
                const safeCurve = Math.min(curve, Math.max(10, dx));
                c1x = startX + safeCurve;
                c2x = endX - safeCurve;
            } else {
                const overlap = Math.abs(dx);
                const curve = Math.min(200, Math.max(60, overlap * 0.8));
                const midX = Math.min(container.scrollWidth || container.clientWidth, startX + curve);
                c1x = midX;
                c2x = midX;
            }
            const isActive = scenarioHoverKey && (edge.from === scenarioHoverKey || edge.to === scenarioHoverKey);
            const isFaded = scenarioHoverKey && !isActive;
            const isContextEdge = !isActive && scenarioEpicFocus && ((fromInFocus && !toInFocus) || (!fromInFocus && toInFocus));
            paths.push({
                id: `${edge.from}-${edge.to}-${edge.type || 'link'}`,
                from: edge.from,
                to: edge.to,
                d: `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`,
                type: edge.type,
                isActive,
                isFaded,
                isContextEdge
            });
        });
        const result = {
            width: container.scrollWidth || container.clientWidth,
            height: container.scrollHeight || container.clientHeight,
            paths
        };
        if (perfEnabled) {
            performance.mark('scenarioEdgeCompute:end');
            performance.measure(
                'scenarioEdgeCompute',
                'scenarioEdgeCompute:start',
                'scenarioEdgeCompute:end'
            );
            performance.clearMarks('scenarioEdgeCompute:start');
            performance.clearMarks('scenarioEdgeCompute:end');
            performance.clearMeasures('scenarioEdgeCompute');
        }
        return result;
    }, [
        scenarioTimelineIssueKeys,
        scenarioEpicFocus,
        scenarioEdgeCandidates,
        scenarioFocusEdges,
        scenarioBaselineEdges,
        scenarioActiveEdges,
        scenarioHoverKey,
        scenarioFocusIssueKeys,
        scenarioPositions,
        scenarioLayout.labelWidth,
        perfEnabled
    ]);

    const clearScenarioEpicFocus = () => {
        if (!scenarioEpicFocus) return;
        const restore = scenarioFocusRestoreRef.current;
        setScenarioEpicFocus(null);
        hideScenarioTooltip();
        setScenarioRangeOverride(restore?.rangeOverride || null);
        if (restore?.laneMode === 'epic') {
            scenarioSkipAutoCollapseRef.current = true;
        }
        if (restore?.laneMode && restore.laneMode !== scenarioLaneMode) {
            setScenarioLaneMode(restore.laneMode);
        }
        if (restore?.collapsedLanes) {
            setScenarioCollapsedLanes(restore.collapsedLanes);
        }
        if (scenarioTimelineRef.current && typeof restore?.scrollTop === 'number') {
            scenarioTimelineRef.current.scrollTo({ top: restore.scrollTop, behavior: 'auto' });
        }
        scenarioFocusRestoreRef.current = null;
    };

    const focusScenarioEpic = (epicKey, epicSummary) => {
        if (!epicKey) return;
        if (scenarioEpicFocus?.key === epicKey) {
            clearScenarioEpicFocus();
            return;
        }
        if (!scenarioEpicFocus) {
            scenarioFocusRestoreRef.current = {
                laneMode: scenarioLaneMode,
                collapsedLanes: { ...scenarioCollapsedLanes },
                scrollTop: scenarioTimelineRef.current?.scrollTop || 0,
                rangeOverride: scenarioRangeOverride
            };
        }
        const cleanedSummary = normalizeScenarioSummary(epicSummary) || epicKey;
        setScenarioEpicFocus({ key: epicKey, summary: cleanedSummary });
        if (scenarioLaneMode !== 'epic') {
            setScenarioLaneMode('epic');
        }
        const DAY_MS = 24 * 60 * 60 * 1000;
        let minStart = null;
        let maxEnd = null;
        scenarioIssues.forEach(issue => {
            if (issue.epicKey !== epicKey) return;
            const start = parseScenarioDate(issue.start);
            const end = parseScenarioDate(issue.end);
            if (!start || !end) return;
            if (!minStart || start < minStart) minStart = start;
            if (!maxEnd || end > maxEnd) maxEnd = end;
        });
        if (minStart && maxEnd) {
            const span = Math.max(1, maxEnd - minStart);
            const padding = Math.max(DAY_MS * 2, span * 0.06);
            setScenarioRangeOverride({
                start: new Date(minStart.getTime() - padding),
                end: new Date(maxEnd.getTime() + padding)
            });
        } else {
            setScenarioRangeOverride(null);
        }
    };

    scheduleScenarioEdgeUpdate = React.useCallback(() => {
        if (!showScenario) return;
        if (document.hidden) return;
        if (perfEnabled) {
            perfCountersRef.current.edgeRequests += 1;
        }
        if (scenarioEdgeFrameRef.current) return;
        if (scenarioEdgeUpdatePendingRef.current) return;
        scenarioEdgeUpdatePendingRef.current = true;
        scenarioEdgeFrameRef.current = window.requestAnimationFrame(() => {
            scenarioEdgeFrameRef.current = null;
            scenarioEdgeUpdatePendingRef.current = false;
            if (perfEnabled) {
                perfCountersRef.current.edgeFrames += 1;
            }
            const nextRender = computeScenarioEdgePaths();
            setScenarioEdgeRender(prev => (areScenarioEdgeRendersEqual(prev, nextRender) ? prev : nextRender));
        });
    }, [computeScenarioEdgePaths, showScenario, perfEnabled]);

    useEffect(() => {
        scheduleScenarioEdgeUpdate();
    }, [
        scenarioLaneMode,
        scenarioCollapsedLanes,
        scenarioRangeOverride,
        scenarioEpicFocus,
        scenarioLayout.width,
        scenarioLayout.height,
        scenarioLaneStacking,
        scheduleScenarioEdgeUpdate
    ]);

    useEffect(() => {
        if (!showScenario) return;
        scheduleScenarioEdgeUpdate();
    }, [showScenario, scenarioPositions, scenarioVisibleLanes, scheduleScenarioEdgeUpdate]);

    useEffect(() => {
        scheduleScenarioEdgeUpdate();
    }, [
        scenarioHoverKey,
        scenarioBaselineEdges,
        scenarioFocusEdges,
        scenarioActiveEdges,
        scenarioTimelineIssueKeys,
        scheduleScenarioEdgeUpdate
    ]);

    const scrollToScenarioIssue = (issueKey) => {
        if (scenarioEpicFocus) {
            scenarioPendingScrollRef.current = issueKey;
            clearScenarioEpicFocus();
            return;
        }
        const issue = scenarioIssueByKey.get(issueKey);
        if (!issue || !scenarioTimelineRef.current) return;

        // First, scroll the main window to bring timeline into view
        const container = scenarioTimelineRef.current;
        const containerTop = container.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: containerTop - 100, behavior: 'smooth' });

        const lane = scenarioLaneForIssue(issue);
        if (scenarioLaneMode === 'epic') {
            setScenarioCollapsedLanes(prev => ({ ...prev, [lane]: false }));
        }
        const position = scenarioPositions[issueKey];
        if (!position) return;

        // Then scroll within the timeline to the specific task
        const axis = container.querySelector('.scenario-axis');
        const axisOffset = axis ? axis.offsetHeight : 0;
        const targetTop = Math.max(0, position.y + axisOffset - container.clientHeight / 2);

        // Delay the timeline scroll slightly to allow page scroll to start
        window.setTimeout(() => {
            container.scrollTo({ top: targetTop, behavior: 'smooth' });
        }, 100);

        setScenarioFlashKey(issueKey);
        window.setTimeout(() => {
            setScenarioFlashKey(current => (current === issueKey ? null : current));
        }, 1400);
    };

    useEffect(() => {
        if (scenarioEpicFocus) return;
        const pendingKey = scenarioPendingScrollRef.current;
        if (!pendingKey) return;
        if (!scenarioPositions[pendingKey]) return;
        scenarioPendingScrollRef.current = null;
        scrollToScenarioIssue(pendingKey);
    }, [scenarioEpicFocus, scenarioPositions]);

    useEffect(() => {
        if (!scenarioEpicFocus || !scenarioTimelineRef.current) return;
        const laneMeta = scenarioLaneMeta.meta.get(scenarioEpicFocus.key);
        if (!laneMeta) return;
        const container = scenarioTimelineRef.current;
        const axis = container.querySelector('.scenario-axis');
        const axisOffset = axis ? axis.offsetHeight : 0;
        const targetTop = Math.max(0, laneMeta.offset - axisOffset);
        container.scrollTo({ top: targetTop, behavior: 'auto' });
    }, [scenarioEpicFocus, scenarioLaneMeta]);

    useEffect(() => {
        if (!scenarioEpicFocus) return;
        const handleKey = (event) => {
            if (readPendingAuthenticationRequired()) return;
            if (event.key === 'Escape') {
                clearScenarioEpicFocus();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('keydown', handleKey);
        };
    }, [scenarioEpicFocus]);
    return {
        registerScenarioIssueRef,
        runScenario,
        toggleScenarioEditMode,
        handleScenarioBarMouseDown,
        scenarioBaseUrl,
        scenarioHasUnsavedChanges,
        scenarioCanSaveDraft,
        scenarioRemoteEditors,
        scenarioIssueLockWarnings,
        scenarioSearchQuery,
        scenarioSearchMatchSet,
        scenarioIssueByKey,
        scenarioViewStart,
        scenarioViewEnd,
        scenarioFocusIssueKeys,
        scenarioFocusContextKeys,
        scenarioAssigneeConflicts,
        scenarioDepViolations,
        scenarioDepViolatedKeys,
        scenarioUndo,
        scenarioRedo,
        scenarioOverrideCount,
        saveScenarioDraft,
        discardScenarioOverrides,
        openScenarioDraftHistory,
        closeScenarioDraftHistory,
        requestReloadActiveDraft,
        cancelReloadActiveDraft,
        runReloadActiveDraft,
        requestScenarioHistoryAction,
        cancelScenarioHistoryAction,
        requestScenarioReloadFromJira,
        cancelScenarioReloadFromJira,
        runScenarioReloadFromJira,
        previewScenarioDraftWriteback,
        checkScenarioDraftWritebackGate,
        runScenarioHistoryAction,
        scenarioLaneInfo,
        scenarioLateItems,
        scenarioDeadlineAtRisk,
        scenarioCriticalPathItems,
        scenarioUnschedulableItems,
        scenarioIssuesByLane,
        scenarioTicks,
        scenarioQuarterMarkers,
        SCENARIO_LANE_HEIGHT,
        scenarioBarGap,
        scenarioJiraEpicKeys,
        scenarioJiraStoryKeys,
        scenarioLaneMeta,
        scenarioLaneAssigneeGroups,
        scenarioPositions,
        scenarioEpicBars,
        scenarioEpicEdges,
        scenarioTodayLeft,
        scenarioVisibleLanes,
        scenarioUpstreamSet,
        scenarioDownstreamSet,
        scenarioBlockedSet,
        toggleScenarioLane,
        showScenarioTooltip,
        showScenarioTooltipFromElement,
        moveScenarioTooltip,
        hideScenarioTooltip,
        clearScenarioEpicFocus,
        focusScenarioEpic,
        scrollToScenarioIssue,
    };
}
