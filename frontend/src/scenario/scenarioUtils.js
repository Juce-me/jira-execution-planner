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
