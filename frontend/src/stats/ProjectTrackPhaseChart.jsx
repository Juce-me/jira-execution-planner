import * as React from 'react';
import { createPortal } from 'react-dom';
import StackedBar from './StackedBar.jsx';
import { sortEpicsByTotalAge } from './projectTrackPhaseStats.js';
import { resolveFloatingHoverPosition } from '../ui/hoverBubblePosition.js';

// ProjectTrackPhaseChart: renders one stacked-bar row per epic showing how
// many days the epic has spent in each Project Track state. Ordered by total
// age descending. Colors and segment labels come from the caller-supplied
// resolveColor (resolveProjectTrackColor) and the state names from the
// endpoint response.
//
// Each row label is a clickable link to the Jira epic (built from jiraUrl with
// the same `${jiraUrl}/browse/${key}` pattern the ENG task/epic rows use) and
// reveals the epic summary in the shared in-app readout bubble on hover/focus
// (positioned via resolveFloatingHoverPosition, matching StackedBar's readout).
//
// Props:
//   rows         – epics array from the endpoint (same shape as the endpoint's
//                  epics[]: { key, summary, durations, created, transitions, currentValue })
//   resolveColor – fn(stateName) -> CSS color string
//   jiraUrl      – Jira base URL for building browse links (falsy -> no link)
const READOUT_MAX_WIDTH = 220;
const READOUT_HEIGHT = 72;

export default function ProjectTrackPhaseChart({ rows, resolveColor, jiraUrl }) {
    const sorted = React.useMemo(() => sortEpicsByTotalAge(rows || []), [rows]);
    const [hovered, setHovered] = React.useState(null);

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
                summary: row.summary || '',
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

    const showSummary = (event, row) => {
        if (!row.summary) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const point = resolveFloatingHoverPosition({
            x: rect.left + (rect.width / 2),
            y: rect.top,
            bubbleWidth: READOUT_MAX_WIDTH,
            bubbleHeight: READOUT_HEIGHT,
        });
        setHovered({ key: row.label, summary: row.summary, ...point });
    };

    const renderRowLabel = (row) => {
        const href = jiraUrl ? `${jiraUrl}/browse/${row.id}` : '';
        const commonProps = {
            className: 'stacked-bar-row-label project-track-phase-epic-link',
            onMouseEnter: (event) => showSummary(event, row),
            onMouseLeave: () => setHovered(null),
            onFocus: (event) => showSummary(event, row),
            onBlur: () => setHovered(null),
        };
        if (!href) {
            return <span {...commonProps}>{row.label}</span>;
        }
        return (
            <a {...commonProps} href={href} target="_blank" rel="noopener">
                {row.label}
            </a>
        );
    };

    const readout = hovered ? (
        <div
            className={`stacked-bar-readout is-${hovered.side || 'right'}`}
            style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}
        >
            <strong>{hovered.key}</strong>
            <span>{hovered.summary}</span>
        </div>
    ) : null;

    return (
        <div className="project-track-phase-chart">
            <StackedBar
                rows={stackedRows}
                segmentOrder={stateOrder}
                resolveColor={resolveColor}
                formatValue={formatDays}
                formatReadout={({ rowLabel, segmentKey, value }) => `${rowLabel} — ${segmentKey}: ${formatDays(value)}`}
                renderRowLabel={renderRowLabel}
                ariaLabel="Time in Project Track phase per epic"
                emptyText="No epic phase data available."
                resolveLabel={(state) => state}
            />
            {readout && typeof document !== 'undefined' && document.body
                ? createPortal(readout, document.body)
                : readout}
        </div>
    );
}
