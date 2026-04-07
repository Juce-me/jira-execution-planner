// Scenario lane grouping utilities.
// Pure functions — no React/DOM dependencies.

const KILLED_STATUS = 'killed';

function normalizeIssueStatus(status) {
    return (status || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Groups issues into lanes, filtering out killed tasks and sorting within each lane.
 *
 * @param {object[]} issues - The flat issue list (scenarioTimelineWithSegments)
 * @param {'team'|'epic'|'assignee'} mode - Current lane mode
 * @param {function} laneForIssue - Maps an issue to its lane key (closure from dashboard.jsx)
 * @returns {Map<string, object[]>} Issues grouped by lane key
 */
export function buildLaneIssues(issues, mode, laneForIssue) {
    const groups = new Map();
    if (!issues || issues.length === 0) return groups;

    issues.forEach(issue => {
        if (normalizeIssueStatus(issue.status) === KILLED_STATUS) return;
        const lane = laneForIssue(issue);
        if (!groups.has(lane)) groups.set(lane, []);
        groups.get(lane).push(issue);
    });

    groups.forEach(list => {
        if (mode === 'team') {
            // Assignee-primary sort ensures same-person rows are always contiguous
            // within the lane stacking algorithm. Unassigned sorts last (\uffff > any letter).
            list.sort((a, b) => {
                const aA = a.assignee || '\uffff';
                const bA = b.assignee || '\uffff';
                if (aA !== bA) return aA.localeCompare(bA);
                return (a.start || '').localeCompare(b.start || '');
            });
        } else {
            list.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
        }
    });

    return groups;
}

/**
 * Extracts excluded-capacity issues and clips their dates to the sprint window.
 * Used to determine which issues occupy the dedicated team-cap row (row 0).
 *
 * @param {object[]} issues - Full issue list for a lane
 * @param {Set<string>} excludedIssueKeys - Keys of excluded-capacity issues
 * @param {string} sprintStartISO - Sprint start as YYYY-MM-DD
 * @param {string} sprintEndISO   - Sprint end as YYYY-MM-DD
 * @returns {object[]} Clipped copies of the capacity placeholder issues
 */
export function buildCapacityPlaceholderRows(issues, excludedIssueKeys, sprintStartISO, sprintEndISO) {
    if (!issues || !excludedIssueKeys || !sprintStartISO || !sprintEndISO) return [];
    return issues
        .filter(issue => {
            const key = issue.originalKey || issue.key;
            return excludedIssueKeys.has(key);
        })
        .map(issue => ({
            ...issue,
            start: !issue.start || issue.start < sprintStartISO ? sprintStartISO : issue.start,
            end:   !issue.end   || issue.end   > sprintEndISO   ? sprintEndISO   : issue.end,
        }));
}
