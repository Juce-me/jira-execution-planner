import * as React from 'react';
import StackedBar from './StackedBar.jsx';
import { sortEpicsByTotalAge } from './projectTrackPhaseStats.js';

// ProjectTrackPhaseChart: renders one stacked-bar row per epic showing how
// many days the epic has spent in each Project Track state. Ordered by total
// age descending. Colors and segment labels come from the caller-supplied
// resolveColor (resolveProjectTrackColor) and the state names from the
// endpoint response.
//
// Props:
//   rows         – epics array from the endpoint (same shape as the endpoint's
//                  epics[]: { key, summary, durations, created, transitions, currentValue })
//   resolveColor – fn(stateName) -> CSS color string
export default function ProjectTrackPhaseChart({ rows, resolveColor }) {
    const sorted = React.useMemo(() => sortEpicsByTotalAge(rows || []), [rows]);

    // Collect the ordered set of state names across all rows (most-days first globally).
    const stateOrder = React.useMemo(() => {
        const totals = {};
        for (const row of sorted) {
            for (const [state, days] of Object.entries(row.durations || {})) {
                totals[state] = (totals[state] || 0) + (days || 0);
            }
        }
        return Object.keys(totals).sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
    }, [sorted]);

    const stackedRows = React.useMemo(() =>
        sorted.map((row) => {
            const total = Object.values(row.durations || {}).reduce((s, d) => s + (d || 0), 0);
            return {
                id: row.key,
                label: row.key,
                total,
                segments: stateOrder.map((state) => ({
                    key: state,
                    value: row.durations?.[state] || 0,
                })),
            };
        }),
    [sorted, stateOrder]);

    const formatDays = (value) => {
        const num = Math.round(Number(value || 0));
        return `${num}d`;
    };

    const hoverLabel = (rowLabel, segmentLabel) => `${rowLabel} — ${segmentLabel}`;

    return (
        <div className="project-track-phase-chart">
            <StackedBar
                rows={stackedRows}
                segmentOrder={stateOrder}
                resolveColor={resolveColor}
                formatValue={formatDays}
                ariaLabel="Time in Project Track phase per epic"
                emptyText="No epic phase data available."
                resolveLabel={(state) => state}
                buildHoverRowLabel={hoverLabel}
            />
        </div>
    );
}
