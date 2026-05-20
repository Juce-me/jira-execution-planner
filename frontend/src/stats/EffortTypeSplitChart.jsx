import * as React from 'react';

const BUCKETS = [
    { key: 'excludedCapacity', label: 'Excluded Capacity' },
    { key: 'tech', label: 'Tech' },
    { key: 'product', label: 'Product' }
];
const READOUT_EDGE_GUTTER = 12;
const READOUT_HORIZONTAL_INSET = 150;
const READOUT_VERTICAL_INSET = 44;

function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function clampReadoutPoint(x, y) {
    if (typeof window === 'undefined') {
        return { x, y };
    }
    const viewportWidth = Number(window.innerWidth) || 0;
    const viewportHeight = Number(window.innerHeight) || 0;
    const useWideInset = viewportWidth > READOUT_HORIZONTAL_INSET * 2;
    const minX = useWideInset ? READOUT_HORIZONTAL_INSET : READOUT_EDGE_GUTTER;
    const maxX = useWideInset
        ? viewportWidth - READOUT_HORIZONTAL_INSET
        : Math.max(minX, viewportWidth - READOUT_EDGE_GUTTER);
    const minY = READOUT_VERTICAL_INSET;
    const maxY = Math.max(minY, viewportHeight - READOUT_EDGE_GUTTER);
    return {
        x: clampNumber(x, minX, maxX),
        y: clampNumber(y, minY, maxY)
    };
}

function formatSegmentValue(segment, metric, formatExcludedPoints, formatPercent) {
    if (metric === 'storyPoints') return `${formatExcludedPoints(segment?.points || 0)} SP`;
    return formatPercent(segment?.percent || 0);
}

function formatSummaryValue(segment, formatExcludedPoints, formatPercent) {
    return `${formatExcludedPoints(segment?.points || 0)} story points, ${formatPercent(segment?.percent || 0)}`;
}

function readoutFromPointer(event, readout) {
    const point = clampReadoutPoint(event.clientX, event.clientY);
    return {
        ...readout,
        ...point
    };
}

function readoutFromElement(event, readout) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = clampReadoutPoint(rect.left + (rect.width / 2), rect.top);
    return {
        ...readout,
        ...point
    };
}

export default function EffortTypeSplitChart({
    rows,
    metric,
    visibleBuckets,
    onToggleBucket,
    formatExcludedPoints,
    formatPercent
}) {
    const activeBuckets = BUCKETS.filter(bucket => visibleBuckets?.[bucket.key] !== false);
    const rowList = Array.isArray(rows) ? rows : [];
    const [hovered, setHovered] = React.useState(null);

    return (
        <div className="effort-type-split-chart" role="group" aria-label="Effort split by type across teams">
            <div className="effort-type-split-legend">
                {BUCKETS.map(bucket => {
                    const isActive = visibleBuckets?.[bucket.key] !== false;
                    return (
                        <button
                            key={bucket.key}
                            type="button"
                            className={`effort-type-split-legend-item ${bucket.key} ${isActive ? 'active' : 'dimmed'}`}
                            aria-pressed={isActive}
                            onClick={() => onToggleBucket?.(bucket.key)}
                        >
                            <span className="effort-type-split-swatch" />
                            {bucket.label}
                        </button>
                    );
                })}
            </div>
            <ul className="effort-type-split-summary" aria-label="Effort split values">
                {rowList.map(row => (
                    <li key={row.teamId}>
                        {row.teamName}: {activeBuckets.map(bucket => {
                            const segment = row.segments?.[bucket.key] || { points: 0, percent: 0 };
                            return `${bucket.label} ${formatSummaryValue(segment, formatExcludedPoints, formatPercent)}`;
                        }).join('; ')}.
                    </li>
                ))}
            </ul>
            {!rowList.length && (
                <div className="cohort-empty">No selected sprint-range story points found for this scope.</div>
            )}
            {rowList.length > 0 && !activeBuckets.length && (
                <div className="cohort-empty">Select at least one effort type.</div>
            )}
            {rowList.length > 0 && activeBuckets.length > 0 && (
                <div className="effort-type-split-rows">
                    {rowList.map(row => {
                        const denominator = row.totalPoints || 0;
                        return (
                            <div className="effort-type-split-row" key={row.teamId}>
                                <div className="effort-type-split-team">
                                    <span>{row.teamName}</span>
                                    <strong>{formatExcludedPoints(row.totalPoints)} SP</strong>
                                </div>
                                <div className="effort-type-split-track">
                                    {activeBuckets.map(bucket => {
                                        const segment = row.segments?.[bucket.key] || { points: 0, percent: 0 };
                                        const width = denominator > 0 ? (segment.points / denominator) * 100 : 0;
                                        const valueText = formatSegmentValue(segment, metric, formatExcludedPoints, formatPercent);
                                        const readout = { teamName: row.teamName, label: bucket.label, valueText };
                                        return (
                                            <button
                                                key={bucket.key}
                                                type="button"
                                                className={`effort-type-split-segment ${bucket.key}`}
                                                style={{ width: `${Math.max(0, Math.min(100, width))}%` }}
                                                tabIndex={0}
                                                onMouseEnter={(event) => setHovered(readoutFromPointer(event, readout))}
                                                onMouseMove={(event) => setHovered(readoutFromPointer(event, readout))}
                                                onMouseLeave={() => setHovered(null)}
                                                onFocus={(event) => setHovered(readoutFromElement(event, readout))}
                                                onBlur={() => setHovered(null)}
                                                onClick={(event) => setHovered(readoutFromElement(event, readout))}
                                                aria-label={`${row.teamName} ${bucket.label}: ${valueText}`}
                                            >
                                                {width >= 12 && <span>{valueText}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {hovered && (
                <div
                    className="effort-type-split-readout"
                    style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}
                >
                    <strong>{hovered.teamName}</strong>
                    <span>{hovered.label}: {hovered.valueText}</span>
                </div>
            )}
        </div>
    );
}
