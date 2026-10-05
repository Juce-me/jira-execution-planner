import { parseScenarioDate, applyIssueOverride, dateToISODate, validateDependencies, splitAtSprintBoundaries, SCENARIO_BAR_HEIGHT, SCENARIO_COLLAPSED_ROWS, SCENARIO_TEAM_LEAD_ROWS } from './scenarioUtils.js';

export function buildScenarioSprintBounds({ scenarioData }) {
    const b = scenarioData?.sprintBoundaries;
    if (!b) return [];
    return [b.previous?.startDate, b.selected?.startDate, b.selected?.endDate, b.next?.endDate]
        .map(d => d ? parseScenarioDate(d) : null)
        .filter(Boolean)
        .sort((a, b) => a - b);
}

export function buildScenarioIssues({ scenarioRawIssues, scenarioCapacityByTeam }) {
    if (!scenarioRawIssues || scenarioRawIssues.length === 0) return scenarioRawIssues;

    return scenarioRawIssues.map(issue => {
        // Check if this is a DevLead Management task
        const epicSummary = issue.epicSummary || '';
        const isDevLeadTask = epicSummary.toLowerCase().includes('devlead management') ||
                             epicSummary.toLowerCase().includes('dev lead management');

        // Only apply virtual assignment if task is unassigned and is a DevLead task
        if (isDevLeadTask && !issue.assignee && issue.team) {
            const teamCapacity = scenarioCapacityByTeam[issue.team];
            const devLead = teamCapacity?.devLead;

            if (devLead) {
                // Return a new issue object with virtual assignment
                return { ...issue, assignee: devLead };
            }
        }

        return issue;
    });
}

export function buildScenarioEffectiveIssues({ scenarioIssues, scenarioOverrides }) {
    if (!scenarioIssues || scenarioIssues.length === 0) return scenarioIssues;
    return scenarioIssues.map(issue => applyIssueOverride(issue, scenarioOverrides[issue.key] || null));
}

export function buildScenarioSearchMatchSet({ scenarioEffectiveIssues, scenarioSearchQuery, matchesScenarioSearch }) {
    const matches = new Set();
    if (!scenarioSearchQuery || !scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return matches;
    scenarioEffectiveIssues.forEach(issue => {
        if (issue?.key && matchesScenarioSearch(issue, scenarioSearchQuery)) {
            matches.add(issue.key);
        }
    });
    return matches;
}

export function buildScenarioFilteredIssues({ scenarioEffectiveIssues, scenarioSearchQuery, scenarioSearchMatchSet }) {
    if (!scenarioSearchQuery) return scenarioEffectiveIssues;
    return scenarioEffectiveIssues.filter(issue => scenarioSearchMatchSet.has(issue.key));
}

export function buildScenarioExcludedIssueKeys({ scenarioEffectiveIssues, excludedEpicSet, normalizeEpicKey }) {
    const keys = new Set();
    if (!scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return keys;
    scenarioEffectiveIssues.forEach(issue => {
        if (excludedEpicSet.has(normalizeEpicKey(issue?.epicKey || ''))) {
            keys.add(issue.key);
        }
    });
    return keys;
}

export function buildScenarioIssueByKey({ scenarioEffectiveIssues }) {
    const map = new Map();
    if (!scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return map;
    scenarioEffectiveIssues.forEach(issue => {
        if (issue?.key) {
            map.set(issue.key, issue);
        }
    });
    return map;
}

export function buildScenarioBaseEnd({ scenarioDeadline, scenarioEffectiveIssues }) {
    if (!scenarioDeadline) return null;
    if (!scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return scenarioDeadline;
    let latest = scenarioDeadline;
    scenarioEffectiveIssues.forEach(issue => {
        if (!issue.end) return;
        const end = parseScenarioDate(issue.end);
        if (end && end > latest) {
            latest = end;
        }
    });
    return latest;
}

export function buildScenarioFocusIssueKeys({ scenarioEffectiveIssues, scenarioFocusEpicKey }) {
    const keys = new Set();
    if (!scenarioFocusEpicKey || !scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return keys;
    scenarioEffectiveIssues.forEach(issue => {
        if (issue.epicKey === scenarioFocusEpicKey && issue.key) {
            keys.add(issue.key);
        }
    });
    return keys;
}

export function buildScenarioFocusContextKeys({ scenarioDependencies, scenarioFocusIssueKeys, scenarioFocusEpicKey }) {
    const keys = new Set();
    if (!scenarioFocusEpicKey) return keys;
    (scenarioDependencies || []).forEach(edge => {
        if (!edge?.from || !edge?.to) return;
        const fromInFocus = scenarioFocusIssueKeys.has(edge.from);
        const toInFocus = scenarioFocusIssueKeys.has(edge.to);
        if (fromInFocus && !toInFocus) {
            keys.add(edge.to);
        } else if (toInFocus && !fromInFocus) {
            keys.add(edge.from);
        }
    });
    return keys;
}

export function buildScenarioTimelineIssues({ scenarioEffectiveIssues, scenarioFilteredIssues, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioFocusContextKeys }) {
    const source = scenarioEpicFocus ? scenarioEffectiveIssues : scenarioFilteredIssues;
    if (!scenarioEpicFocus) return source;
    return source.filter(issue =>
        scenarioFocusIssueKeys.has(issue.key) || scenarioFocusContextKeys.has(issue.key)
    );
}

export function buildScenarioTimelineWithSegments({ scenarioTimelineIssues, scenarioExcludedIssueKeys, scenarioSprintBounds, scenarioViewStart, scenarioDeadline }) {
    if (!scenarioTimelineIssues || scenarioTimelineIssues.length === 0) return scenarioTimelineIssues;
    if (!scenarioSprintBounds || scenarioSprintBounds.length < 2) return scenarioTimelineIssues;
    // Clip excluded capacity issues to the selected sprint window so
    // they never extend beyond the sprint they belong to.
    const sprintStartISO = scenarioViewStart ? dateToISODate(scenarioViewStart) : null;
    const sprintEndISO   = scenarioDeadline  ? dateToISODate(scenarioDeadline)  : null;
    const result = [];
    scenarioTimelineIssues.forEach(issue => {
        if (scenarioExcludedIssueKeys.has(issue.key)) {
            const segments = splitAtSprintBoundaries(issue, scenarioSprintBounds);
            segments.forEach(seg => {
                if (sprintStartISO && sprintEndISO) {
                    const clippedStart = !seg.start || seg.start < sprintStartISO ? sprintStartISO : seg.start;
                    const clippedEnd   = !seg.end   || seg.end   > sprintEndISO   ? sprintEndISO   : seg.end;
                    if (clippedStart <= clippedEnd) {
                        result.push({ ...seg, start: clippedStart, end: clippedEnd });
                    }
                } else {
                    result.push(seg);
                }
            });
        } else {
            result.push(issue);
        }
    });
    return result;
}

export function buildScenarioAssigneeConflicts({ scenarioTimelineIssues, excludedEpicSet, normalizeEpicKey }) {
    // Early return if no data to avoid unnecessary computation
    if (!scenarioTimelineIssues || scenarioTimelineIssues.length === 0) {
        return { conflicts: new Set(), conflictDetails: new Map() };
    }

    const conflicts = new Set();
    const conflictDetails = new Map();
    const assigneeMap = new Map();

    // Group issues by assignee
    scenarioTimelineIssues.forEach(issue => {
        const assignee = issue.assignee;
        if (!assignee) return;
        if (!issue.start || !issue.end) return;

        // Skip excluded tasks - they're just noise and shouldn't create conflicts
        const isExcluded = excludedEpicSet.has(normalizeEpicKey(issue.epicKey || ''));
        if (isExcluded) return;

        // Skip done tasks - they're complete and can't create real conflicts
        if (issue.scheduledReason === 'already_done') return;

        const startDate = parseScenarioDate(issue.start);
        const endDate = parseScenarioDate(issue.end);
        if (!startDate || !endDate) return;

        if (!assigneeMap.has(assignee)) {
            assigneeMap.set(assignee, []);
        }
        assigneeMap.get(assignee).push({
            key: issue.key,
            start: startDate,
            end: endDate,
            summary: issue.summary
        });
    });

    // Check for overlaps within each assignee's tasks
    assigneeMap.forEach((tasks, assignee) => {
        if (tasks.length < 2) return;

        // Sort by start date
        tasks.sort((a, b) => a.start - b.start);

        // Only check adjacent tasks (optimization)
        for (let i = 0; i < tasks.length - 1; i++) {
            const task1 = tasks[i];
            const task2 = tasks[i + 1];

            // Check if task1 ends AFTER task2 starts (true overlap)
            if (task1.end && task2.start && task1.end.getTime() > task2.start.getTime()) {
                conflicts.add(task1.key);
                conflicts.add(task2.key);

                if (!conflictDetails.has(task1.key)) {
                    conflictDetails.set(task1.key, []);
                }
                if (!conflictDetails.has(task2.key)) {
                    conflictDetails.set(task2.key, []);
                }
                conflictDetails.get(task1.key).push(task2.key);
                conflictDetails.get(task2.key).push(task1.key);
            }
        }
    });

    return { conflicts, conflictDetails };
}

export function buildScenarioDepViolations({ scenarioEditMode, scenarioDependencies, scenarioIssueByKey }) {
    if (!scenarioEditMode) return new Set();
    return validateDependencies(scenarioDependencies, scenarioIssueByKey);
}

export function buildScenarioDepViolatedKeys({ scenarioDepViolations }) {
    const keys = new Set();
    scenarioDepViolations.forEach(edge => {
        const [from, to] = edge.split('->');
        if (from) keys.add(from);
        if (to) keys.add(to);
    });
    return keys;
}

export function buildScenarioLaneInfo({ scenarioTimelineIssues, scenarioLaneMode, scenarioCapacityByTeam, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioExcludedIssueKeys, scenarioAssigneeConflicts, scenarioLaneForIssue }) {
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
}

export function buildScenarioLateItems({ scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet }) {
    return (scenarioSummary.late_items || []).filter(key => (
        !scenarioExcludedIssueKeys.has(key)
        && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
    ));
}

export function buildScenarioCriticalPathItems({ scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet }) {
    return (scenarioSummary.critical_path || []).filter(key => (
        !scenarioExcludedIssueKeys.has(key)
        && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
    ));
}

export function buildScenarioUnschedulableItems({ scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet }) {
    return (scenarioSummary.unschedulable || []).filter(key => (
        !scenarioExcludedIssueKeys.has(key)
        && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
    ));
}

export function buildScenarioTicks({ scenarioViewStart, scenarioViewEnd }) {
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
}

export function buildScenarioQuarterMarkers({ scenarioViewStart, scenarioViewEnd, scenarioDeadline }) {
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
}

export function buildScenarioLaneStacking({ scenarioLanes, scenarioIssuesByLane, scenarioViewStart, scenarioCollapsedLanes, scenarioLaneMode, scenarioCapacityByTeam, scenarioExcludedIssueKeys, scenarioEpicFocus, excludedEpicSet, normalizeEpicKey }) {
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
    return { rowIndexByKey, laneRowCounts, laneVisibleRows, laneHiddenCounts, laneRowAssignees };
}

export function buildScenarioVisibleExportIssues({ scenarioTimelineWithSegments, scenarioShowConflictsOnly, scenarioAssigneeConflicts, scenarioLaneStacking, scenarioLaneForIssue }) {
    if (!scenarioTimelineWithSegments || scenarioTimelineWithSegments.length === 0) return [];
    return scenarioTimelineWithSegments.filter(issue => {
        if (!issue?.key) return false;
        if (scenarioShowConflictsOnly && !scenarioAssigneeConflicts.conflicts.has(issue.key)) return false;
        const lane = scenarioLaneForIssue(issue);
        const rowIndex = scenarioLaneStacking.rowIndexByKey.get(issue.key) ?? 0;
        const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
        return rowIndex < visibleRows;
    });
}

export function buildScenarioLaneMeta({ scenarioLanes, scenarioLaneStacking, scenarioCollapsedLanes, scenarioEpicFocus, scenarioBarGap }) {
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
}

export function buildScenarioLaneAssigneeGroups({ scenarioLaneMode, scenarioLanes, scenarioLaneStacking }) {
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
}

export function buildScenarioPositions({ scenarioTimelineWithSegments, scenarioViewStart, scenarioViewEnd, scenarioLayout, scenarioLaneMeta, scenarioBarGap, scenarioLaneStacking, scenarioLaneForIssue }) {
    const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
    const positions = {};

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
}

export function buildScenarioEdgeCandidates({ scenarioDependencies, scenarioTimelineIssueKeys }) {
    return (scenarioDependencies || []).filter(edge =>
        edge?.from &&
        edge?.to &&
        scenarioTimelineIssueKeys.has(edge.from) &&
        scenarioTimelineIssueKeys.has(edge.to)
    );
}

export function buildScenarioEdgeIndex({ scenarioEdgeCandidates }) {
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
}

export function buildScenarioEpicBars({ scenarioIssuesByLane, scenarioLanes, scenarioLaneMode, scenarioViewStart, scenarioViewEnd, scenarioLayout, scenarioLaneMeta, scenarioIssueByKey, scenarioEpicFocus, excludedEpicSet, SCENARIO_LANE_HEIGHT, normalizeEpicKey }) {
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
}

export function buildScenarioEpicEdges({ scenarioDependencies, scenarioLaneMeta, scenarioLaneMode, scenarioIssueByKey, scenarioEpicFocus }) {
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
}

export function buildScenarioVisibleLanes({ scenarioLanes, scenarioLaneMeta, scenarioScrollTop, scenarioViewportHeight }) {
    if (!scenarioViewportHeight) return scenarioLanes;
    const buffer = 80;
    const start = scenarioScrollTop - buffer;
    const end = scenarioScrollTop + scenarioViewportHeight + buffer;
    return scenarioLanes.filter(lane => {
        const meta = scenarioLaneMeta.meta.get(lane);
        if (!meta) return false;
        return meta.offset + meta.height >= start && meta.offset <= end;
    });
}

export function buildScenarioActiveEdges({ scenarioEdgeCandidates, scenarioHoverKey }) {
    if (!scenarioHoverKey) return [];
    return scenarioEdgeCandidates.filter(edge => edge.from === scenarioHoverKey || edge.to === scenarioHoverKey);
}

export function buildScenarioUpstreamSet({ scenarioHoverKey, scenarioEdgeIndex }) {
    if (!scenarioHoverKey) return new Set();
    return new Set(scenarioEdgeIndex.incoming.get(scenarioHoverKey) || []);
}

export function buildScenarioDownstreamSet({ scenarioHoverKey, scenarioEdgeIndex }) {
    if (!scenarioHoverKey) return new Set();
    return new Set(scenarioEdgeIndex.outgoing.get(scenarioHoverKey) || []);
}

export function buildScenarioBlockedSet({ scenarioDependencies }) {
    const blocked = new Set();
    (scenarioDependencies || []).forEach(edge => {
        if (edge.type === 'block' && edge.to) {
            blocked.add(edge.to);
        }
    });
    return blocked;
}

export function buildScenarioFocusEdges({ scenarioEpicFocus, scenarioEdgeCandidates, scenarioFocusIssueKeys, scenarioFocusContextKeys }) {
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
}
