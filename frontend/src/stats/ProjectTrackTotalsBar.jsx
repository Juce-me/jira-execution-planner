import * as React from 'react';
import StackedBar from './StackedBar.jsx';

// Single-row totals bar: the whole selected range collapsed into one stacked bar by
// track, with the range label beside it and a track legend acting as the shared color
// key for the per-sprint and breakdown charts below.
export default function ProjectTrackTotalsBar({ byTrack, tracks, resolveColor, rangeLabel }) {
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
            <ul className="project-track-legend" aria-label="Project track legend">
                {trackList.map((track) => (
                    <li className="project-track-legend-item" key={track}>
                        <i
                            className="project-track-swatch"
                            style={{ background: resolveColor ? resolveColor(track) : '#94a3b8' }}
                        />
                        {track}
                    </li>
                ))}
            </ul>
            <StackedBar
                rows={rows}
                segmentOrder={trackList}
                resolveColor={resolveColor}
                ariaLabel="Total story points by project track"
                emptyText="No story points in the selected sprint range."
            />
        </div>
    );
}
