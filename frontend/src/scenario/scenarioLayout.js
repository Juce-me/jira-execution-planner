import { parseScenarioDate, applyIssueOverride, dateToISODate, validateDependencies, splitAtSprintBoundaries } from './scenarioUtils.js';

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
