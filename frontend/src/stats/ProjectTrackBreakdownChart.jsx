import * as React from 'react';
import StackedBar from './StackedBar.jsx';

// Per-assignee (Epic mode) / per-team (Team mode) breakdown: one stacked bar per row,
// each split by track, rows already sorted by total in the Task 2 helper.
export default function ProjectTrackBreakdownChart({ data, resolveColor }) {
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    const rows = (Array.isArray(data?.rows) ? data.rows : []).map((row) => ({
        id: row.id,
        label: row.label,
        total: row.total,
        segments: tracks.map((track) => ({ key: track, value: row.byTrack?.[track] || 0 }))
    }));

    return (
        <StackedBar
            rows={rows}
            segmentOrder={tracks}
            resolveColor={resolveColor}
            ariaLabel="Story points by track per row"
            emptyText="No story points in the selected sprint range."
        />
    );
}
