// Scenario planner pure utility functions and constants.
// Extracted from dashboard.jsx — zero closure dependencies.

export const SCENARIO_BAR_HEIGHT = 32;
export const SCENARIO_BAR_GAP = 10;
export const SCENARIO_COLLAPSED_ROWS = 2;
export const SCENARIO_TEAM_LEAD_ROWS = 1;

export function parseScenarioDate(value) {
    if (!value) return null;
    // Parse ISO date string (YYYY-MM-DD) as local date at midnight
    // Adding T00:00:00 without timezone creates local date, avoiding timezone day-shift bugs
    // Backend sends dates as date.isoformat() → "2026-01-29"
    // This must parse as local 2026-01-29, not UTC (which could shift to 2026-01-28 in some timezones)
    return new Date(`${value}T00:00:00`);
}

export function normalizeScenarioSummary(summary) {
    const text = String(summary || '').trim();
    if (!text) return '';
    return text.replace(/^issue\.\s*/i, '');
}

export function computeDateSource(overrideStart, overrideEnd, jiraStart, jiraDue) {
    if (overrideStart || overrideEnd) return 'override';
    if (jiraStart || jiraDue) return 'jira';
    return 'computed';
}

export function applyIssueOverride(issue, override) {
    if (!override) {
        // No override — compute dateSource from jira dates only
        const dateSource = computeDateSource(null, null, issue.jiraStartDate, issue.jiraDueDate);
        return dateSource === 'computed' ? issue : { ...issue, dateSource };
    }
    const effectiveStart = override.start || issue.jiraStartDate || issue.start;
    const effectiveEnd = override.end || issue.jiraDueDate || issue.end;
    const dateSource = computeDateSource(override.start, override.end, issue.jiraStartDate, issue.jiraDueDate);
    return {
        ...issue,
        start: effectiveStart,
        end: effectiveEnd,
        dateSource,
    };
}

export function splitAtSprintBoundaries(issue, sprintBoundaries) {
    if (!sprintBoundaries || sprintBoundaries.length < 2) return [issue];
    const start = parseScenarioDate(issue.start);
    const end = parseScenarioDate(issue.end);
    if (!start || !end) return [issue];

    // Find boundaries that fall strictly within the bar's range
    const splits = sprintBoundaries.filter(b => b > start && b < end);
    if (splits.length === 0) return [issue];

    const segments = [];
    let segStart = start;
    const allBounds = [...splits, end];

    allBounds.forEach((bound, idx) => {
        const segEnd = bound;
        const segKey = `${issue.key}__seg${idx}`;
        segments.push({
            ...issue,
            key: segKey,
            originalKey: issue.key,
            start: dateToISODate(segStart),
            end: dateToISODate(segEnd),
        });
        segStart = segEnd;
    });

    return segments;
}

export function validateDependencies(dependencies, issueByKey) {
    const violations = new Set();
    if (!dependencies || !issueByKey) return violations;
    dependencies.forEach(edge => {
        if (!edge?.from || !edge?.to) return;
        const fromIssue = issueByKey.get(edge.from);
        const toIssue = issueByKey.get(edge.to);
        if (!fromIssue || !toIssue) return;
        const fromEnd = parseScenarioDate(fromIssue.end);
        const toStart = parseScenarioDate(toIssue.start);
        if (!fromEnd || !toStart) return;
        // Violated if dependent (to) starts before prerequisite (from) ends
        if (toStart.getTime() < fromEnd.getTime()) {
            violations.add(`${edge.from}->${edge.to}`);
        }
    });
    return violations;
}

export function createUndoStack() {
    let undoList = [];
    let redoList = [];
    return {
        push(cmd) {
            undoList.push(cmd);
            redoList = [];
        },
        undo() {
            if (undoList.length === 0) return null;
            const cmd = undoList.pop();
            redoList.push(cmd);
            return cmd;
        },
        redo() {
            if (redoList.length === 0) return null;
            const cmd = redoList.pop();
            undoList.push(cmd);
            return cmd;
        },
        canUndo() { return undoList.length > 0; },
        canRedo() { return redoList.length > 0; },
        clear() { undoList = []; redoList = []; },
    };
}

export function pxToDate(px, trackWidth, viewStart, viewEnd) {
    const totalMs = viewEnd.getTime() - viewStart.getTime();
    const ratio = Math.max(0, Math.min(1, px / trackWidth));
    const ms = viewStart.getTime() + ratio * totalMs;
    // Snap to midnight (start of day)
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function dateToPx(date, trackWidth, viewStart, viewEnd) {
    const totalMs = viewEnd.getTime() - viewStart.getTime();
    if (totalMs <= 0) return 0;
    const ratio = (date.getTime() - viewStart.getTime()) / totalMs;
    return ratio * trackWidth;
}

export function dateToISODate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function buildScenarioTooltipPayload(summary, key, sp, isExcluded = false, hasConflict = false, assignee = null, conflictingKeys = [], isOutOfSprint = false, isInProgress = false, team = null) {
    const cleanedSummary = normalizeScenarioSummary(summary) || key || '';
    const hasSp = sp !== null && sp !== undefined && sp !== '';
    const spValue = hasSp ? Number(sp) : null;
    let note = '';
    if (isExcluded) {
        note = 'Excluded (capacity noise)';
    } else if (hasConflict && assignee && conflictingKeys.length > 0) {
        const taskList = conflictingKeys.slice(0, 3).join(', ');
        const more = conflictingKeys.length > 3 ? ` +${conflictingKeys.length - 3} more` : '';
        note = `⚠️ ${assignee} also assigned to: ${taskList}${more}`;
    } else if (hasConflict && assignee) {
        note = `⚠️ ${assignee} has overlapping tasks`;
    } else if (isOutOfSprint) {
        note = '🟠 Finishes after quarter end';
    } else if (isInProgress) {
        note = '🟡 In progress (50% estimated complete)';
    }
    return {
        summary: cleanedSummary,
        key: key || '',
        sp: Number.isFinite(spValue) ? spValue : null,
        note: note,
        assignee: assignee || null,
        team: team || null
    };
}
