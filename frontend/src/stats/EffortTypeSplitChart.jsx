import * as React from 'react';

const BUCKETS = [
    { key: 'excludedCapacity', label: 'Excluded Capacity' },
    { key: 'tech', label: 'Tech' },
    { key: 'product', label: 'Product' }
];

function formatSegmentValue(segment, metric, formatExcludedPoints, formatPercent) {
    if (metric === 'storyPoints') return `${formatExcludedPoints(segment?.points || 0)} SP`;
    return formatPercent(segment?.percent || 0);
}

function formatSummaryValue(segment, formatExcludedPoints, formatPercent) {
    return `${formatExcludedPoints(segment?.points || 0)} story points, ${formatPercent(segment?.percent || 0)}`;
}

export default function EffortTypeSplitChart({
    rows,
    metric,
    visibleBuckets,
    formatExcludedPoints,
    formatPercent
}) {
    const activeBuckets = BUCKETS.filter(bucket => visibleBuckets?.[bucket.key] !== false);
    const rowList = Array.isArray(rows) ? rows : [];
    const [hovered, setHovered] = React.useState(null);

    if (!rowList.length) {
        return <div className="cohort-empty">No selected-sprint story points found for this scope.</div>;
    }
    if (!activeBuckets.length) {
        return <div className="cohort-empty">Select at least one effort type.</div>;
    }

    return (
        <div className="effort-type-split-chart" role="group" aria-label="Effort split by type across teams">
            <div className="effort-type-split-legend" aria-hidden="true">
                {activeBuckets.map(bucket => (
                    <span key={bucket.key} className={`effort-type-split-legend-item ${bucket.key}`}>
                        <span className="effort-type-split-swatch" />
                        {bucket.label}
                    </span>
                ))}
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
                                            onMouseEnter={() => setHovered(readout)}
                                            onMouseLeave={() => setHovered(null)}
                                            onFocus={() => setHovered(readout)}
                                            onBlur={() => setHovered(null)}
                                            onClick={() => setHovered(readout)}
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
            {hovered && (
                <div className="effort-type-split-readout">
                    <strong>{hovered.teamName}</strong>
                    <span>{hovered.label}: {hovered.valueText}</span>
                </div>
            )}
        </div>
    );
}
