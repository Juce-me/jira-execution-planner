import * as React from 'react';
import StackedBar from './StackedBar.jsx';
import { projectTrackStripParts } from './projectTrackStats.js';

// Single-row totals bar: the whole selected range collapsed into one stacked bar by
// track, with the range label beside it. The bars carry the track names, so there is no
// separate legend. Team mode passes `columnSplit` for the Board-column strips (#173).
export default function ProjectTrackTotalsBar({ byTrack, tracks, resolveColor, rangeLabel, columnSplit }) {
    const trackList = Array.isArray(tracks) ? tracks : [];
    const totals = byTrack || {};
    const total = trackList.reduce((sum, track) => sum + (totals[track] || 0), 0);
    const rows = total > 0
        ? [{
            id: 'all',
            label: rangeLabel || 'All sprints',
            total,
            segments: trackList.map((track) => ({ key: track, value: totals[track] || 0 }))
        }]
        : [];

    return (
        <div className="project-track-totals">
            <div className="project-track-totals-head">
                <span className="project-track-totals-label">Story points by track</span>
                {rangeLabel && <span className="project-track-totals-range">{rangeLabel}</span>}
            </div>
            <StackedBar
                rows={rows}
                segmentOrder={trackList}
                resolveColor={resolveColor}
                resolveSegmentStrip={columnSplit
                    ? ({ segmentKey }) => ({ parts: projectTrackStripParts(columnSplit, columnSplit.all, segmentKey) })
                    : undefined}
                ariaLabel="Total story points by project track"
                emptyText="No story points in the selected sprint range."
            />
        </div>
    );
}
