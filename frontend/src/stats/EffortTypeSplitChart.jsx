import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingHoverPosition } from '../ui/hoverBubblePosition.js';

// Stacked-segment buckets. `product` is Product EXCLUDING Ad Hoc ("Product other");
// Ad Hoc is shown as its own included-Product segment. Bucket order:
// Excluded Capacity, Ad Hoc, Product, Tech.
const BUCKETS = [
    { key: 'excludedCapacity', label: 'Excluded Capacity' },
    { key: 'adHoc', label: 'Ad Hoc' },
    { key: 'product', label: 'Product' },
    { key: 'tech', label: 'Tech' }
];
const READOUT_EDGE_GUTTER = 12;
const READOUT_POINTER_GAP = 12;
const READOUT_MAX_WIDTH = 220;
const READOUT_HEIGHT = 72;
const READOUT_VERTICAL_INSET = 56;
const FULL_SEGMENT_LABEL_MIN_WIDTH = 10.5;

const SERIES_ANALYTICS_TOKENS = { excludedCapacity: 'excluded_capacity', adHoc: 'ad_hoc' };

function seriesAnalyticsToken(bucketKey) {
    return SERIES_ANALYTICS_TOKENS[bucketKey] || bucketKey;
}

function clampReadoutPoint(x, y) {
    return resolveFloatingHoverPosition({
        x,
        y,
        bubbleWidth: READOUT_MAX_WIDTH,
        bubbleHeight: READOUT_HEIGHT,
        edgeGutter: READOUT_EDGE_GUTTER,
        pointerGap: READOUT_POINTER_GAP,
        verticalInset: READOUT_VERTICAL_INSET
    });
}

function formatSegmentValue(segment, metric, formatExcludedPoints, formatPercent) {
    if (metric === 'storyPoints') return `${formatExcludedPoints(segment?.points || 0)} SP`;
    return formatPercent(segment?.percent || 0);
}

function formatCompactSegmentValue(segment, metric, formatExcludedPoints) {
    if (metric === 'storyPoints') return `${formatExcludedPoints(segment?.points || 0)} SP`;
    const percentValue = Number(segment?.percent || 0) * 100;
    return `${Math.round(percentValue)}%`;
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
    onAnalyticsAction,
    formatExcludedPoints,
    formatPercent
}) {
    const activeBuckets = BUCKETS.filter(bucket => visibleBuckets?.[bucket.key] !== false);
    const rowList = Array.isArray(rows) ? rows : [];
    const [hovered, setHovered] = React.useState(null);
    const readout = hovered ? (
        <div
            className={`effort-type-split-readout is-${hovered.side || 'right'}`}
            style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}
        >
            <strong>{hovered.teamName}</strong>
            <span>{hovered.label}: {hovered.valueText}</span>
        </div>
    ) : null;

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
                            onClick={() => {
                                onAnalyticsAction?.('chart_action', {
                                    workflow_action: 'toggle_series',
                                    chart_id: 'effort_split',
                                    series_type: seriesAnalyticsToken(bucket.key),
                                    value_state: isActive ? 'off' : 'on'
                                });
                                onToggleBucket?.(bucket.key);
                            }}
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
                                        const compactValueText = formatCompactSegmentValue(segment, metric, formatExcludedPoints);
                                        const labelText = width >= FULL_SEGMENT_LABEL_MIN_WIDTH ? valueText : compactValueText;
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
                                                onClick={(event) => {
                                                    onAnalyticsAction?.('chart_action', {
                                                        workflow_action: 'readout_open',
                                                        chart_id: 'effort_split',
                                                        series_type: seriesAnalyticsToken(bucket.key)
                                                    });
                                                    setHovered(readoutFromElement(event, readout));
                                                }}
                                                aria-label={`${row.teamName} ${bucket.label}: ${valueText}`}
                                            >
                                                {width > 0 && <span>{labelText}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {readout && typeof document !== 'undefined' && document.body
                ? createPortal(readout, document.body)
                : readout}
        </div>
    );
}
