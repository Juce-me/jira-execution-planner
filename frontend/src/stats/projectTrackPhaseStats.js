// Helpers for the time-in-Project-Track-phase section (Epic mode only).
// Consumes the response shape of POST /api/stats/project-track-phase-durations.
import { NO_TRACK_LABEL } from './projectTrackStats.js';

// totalAge: sum of all days across all states for one epic.
function totalAge(epicRow) {
    return Object.values(epicRow.durations || {}).reduce((sum, d) => sum + (d || 0), 0);
}

// sortEpicsByTotalAge: orders descending by total calendar days across all states.
export function sortEpicsByTotalAge(epics) {
    return (epics || []).slice().sort((a, b) => totalAge(b) - totalAge(a));
}

// summarizeTrackPhaseDurations: aggregates the epics array from the endpoint response.
//
// byState: sum of days per state across all epics. State labels come verbatim from
//   the endpoint (e.g. "No track", "Flexible", "Committed").
//
// avgDaysToFirstTrack: average of durations[NO_TRACK_LABEL] across epics that have
//   at least one transition entry. Rationale: a non-empty transitions array means the
//   epic was ever assigned a Project Track value; for those epics the "No track"
//   bucket represents time spent untracked before the first track assignment.
//   Epics with zero transitions are still completely untracked, so they are excluded —
//   including them would conflate "never touched" epics with the time-to-first-track
//   signal. Missing "No track" key is treated as 0 for epics that do have
//   transitions (they went directly to a non-null track from creation).
//   Returns 0 when no epics have any transitions.
//
// avgDaysToCommitted: for epics that have a transition whose `to` field equals
//   "Committed", compute the days from epic.created to that FIRST Committed
//   transition's date; average across only those epics. Returns null when no epic
//   ever reached Committed.
export function summarizeTrackPhaseDurations(epics) {
    const rows = epics || [];

    // byState accumulation.
    const byState = {};
    for (const row of rows) {
        for (const [state, days] of Object.entries(row.durations || {})) {
            byState[state] = (byState[state] || 0) + (days || 0);
        }
    }

    // avgDaysToFirstTrack: only for epics that have at least one transition.
    const trackedRows = rows.filter(r => Array.isArray(r.transitions) && r.transitions.length > 0);
    let avgDaysToFirstTrack = 0;
    if (trackedRows.length > 0) {
        const totalUntracked = trackedRows.reduce((sum, r) => sum + (r.durations?.[NO_TRACK_LABEL] || 0), 0);
        avgDaysToFirstTrack = Math.round(totalUntracked / trackedRows.length);
    }

    // avgDaysToCommitted: epics that have a transition with to === "Committed".
    const committedRows = rows.filter(r =>
        Array.isArray(r.transitions) && r.transitions.some(t => t.to === 'Committed')
    );
    let avgDaysToCommitted = null;
    if (committedRows.length > 0) {
        const totalDays = committedRows.reduce((sum, r) => {
            const created = new Date(r.created);
            const firstCommitted = r.transitions
                .filter(t => t.to === 'Committed')
                .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
            const committed = new Date(firstCommitted.date);
            const diffMs = committed - created;
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
            return sum + Math.max(0, diffDays);
        }, 0);
        avgDaysToCommitted = Math.round(totalDays / committedRows.length);
    }

    return { byState, avgDaysToFirstTrack, avgDaysToCommitted };
}
