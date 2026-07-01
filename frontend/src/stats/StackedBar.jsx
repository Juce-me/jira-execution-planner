import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingHoverPosition } from '../ui/hoverBubblePosition.js';

// Generic horizontal stacked-bar primitive: N rows, each split into dynamic segments
// sized by value share of the row total, with per-segment value labels (compact
// fallback when the segment is too narrow) and a pointer-clamped floating readout.
// The per-segment width math, the FULL_SEGMENT_LABEL_MIN_WIDTH compact-label rule, and
// the clampReadoutPoint readout are lifted from EffortTypeSplitChart.jsx so new charts
// (ProjectTrackTotalsBar, ProjectTrackBreakdownChart) share one implementation.
// Future consolidation: EffortTypeSplitChart should also consume this primitive once
// its Excluded Capacity readout/analytics behavior is re-validated.

const READOUT_EDGE_GUTTER = 12;
const READOUT_POINTER_GAP = 12;
const READOUT_MAX_WIDTH = 220;
const READOUT_HEIGHT = 72;
const READOUT_VERTICAL_INSET = 56;
const FULL_SEGMENT_LABEL_MIN_WIDTH = 10.5;

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

function readoutFromPointer(event, readout) {
    const point = clampReadoutPoint(event.clientX, event.clientY);
    return { ...readout, ...point };
}

function readoutFromElement(event, readout) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = clampReadoutPoint(rect.left + (rect.width / 2), rect.top);
    return { ...readout, ...point };
}

function defaultFormatValue(value) {
    const num = Number(value || 0);
    const rounded = Math.round(num * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} SP`;
}

export default function StackedBar({
    rows,
    segmentOrder,
    resolveColor,
    resolveLabel,
    formatValue = defaultFormatValue,
    formatReadout,          // optional: ({ rowLabel, segmentKey, value }) => string
    ariaLabel,
    emptyText = 'No data in range.'
}) {
    const rowList = Array.isArray(rows) ? rows : [];
    const order = Array.isArray(segmentOrder) ? segmentOrder : [];
    const [hovered, setHovered] = React.useState(null);
    const labelFor = (key) => (resolveLabel ? resolveLabel(key) : key);

    const readout = hovered ? (
        <div
            className={`stacked-bar-readout is-${hovered.side || 'right'}`}
            style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}
        >
            {formatReadout
                ? <span>{formatReadout({ rowLabel: hovered.rowLabel, segmentKey: hovered.segmentKey, value: hovered.value })}</span>
                : <>
                    <strong>{hovered.rowLabel}</strong>
                    <span>{hovered.segmentLabel}: {hovered.valueText}</span>
                  </>
            }
        </div>
    ) : null;

    return (
        <div className="stacked-bar" role="group" aria-label={ariaLabel}>
            {!rowList.length && <div className="stacked-bar-empty">{emptyText}</div>}
            {rowList.length > 0 && (
                <div className="stacked-bar-rows">
                    {rowList.map((row) => {
                        const denominator = row.total || 0;
                        const segMap = {};
                        (row.segments || []).forEach((seg) => { segMap[seg.key] = seg.value || 0; });
                        return (
                            <div className="stacked-bar-row" key={row.id}>
                                <div className="stacked-bar-meta">
                                    <span className="stacked-bar-row-label">{row.label}</span>
                                    <strong className="stacked-bar-row-total">{formatValue(row.total)}</strong>
                                </div>
                                <div className="stacked-bar-track">
                                    {order.map((key) => {
                                        const value = segMap[key] || 0;
                                        if (value <= 0) return null;
                                        const width = denominator > 0 ? (value / denominator) * 100 : 0;
                                        const valueText = formatValue(value);
                                        const segmentLabel = labelFor(key);
                                        const showFull = width >= FULL_SEGMENT_LABEL_MIN_WIDTH;
                                        const readoutData = { rowLabel: row.label, segmentKey: key, segmentLabel, valueText, value };
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                className="stacked-bar-segment"
                                                style={{
                                                    width: `${Math.max(0, Math.min(100, width))}%`,
                                                    '--stacked-bar-color': resolveColor ? resolveColor(key) : '#94a3b8'
                                                }}
                                                tabIndex={0}
                                                onMouseEnter={(event) => setHovered(readoutFromPointer(event, readoutData))}
                                                onMouseMove={(event) => setHovered(readoutFromPointer(event, readoutData))}
                                                onMouseLeave={() => setHovered(null)}
                                                onFocus={(event) => setHovered(readoutFromElement(event, readoutData))}
                                                onBlur={() => setHovered(null)}
                                                onClick={(event) => setHovered(readoutFromElement(event, readoutData))}
                                                aria-label={`${row.label} ${segmentLabel}: ${valueText}`}
                                            >
                                                <span>{showFull ? `${segmentLabel} ${valueText}` : valueText}</span>
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
