import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingHoverPosition } from '../ui/hoverBubblePosition.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';

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
const READOUT_LINE_HEIGHT = 23;
const READOUT_VERTICAL_INSET = 56;
const FULL_SEGMENT_LABEL_MIN_WIDTH = 10.5;

function clampReadoutPoint(x, y, lineCount = 0) {
    return resolveFloatingHoverPosition({
        x,
        y,
        bubbleWidth: READOUT_MAX_WIDTH,
        bubbleHeight: READOUT_HEIGHT + (lineCount * READOUT_LINE_HEIGHT),
        edgeGutter: READOUT_EDGE_GUTTER,
        pointerGap: READOUT_POINTER_GAP,
        verticalInset: READOUT_VERTICAL_INSET
    });
}

function readoutFromPointer(event, readout) {
    const point = clampReadoutPoint(event.clientX, event.clientY, readout.lines?.length || 0);
    return { ...readout, ...point };
}

function readoutFromElement(event, readout) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = clampReadoutPoint(rect.left + (rect.width / 2), rect.top, readout.lines?.length || 0);
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
    renderRowLabel,         // optional: (row) => ReactNode; default = plain-text row.label
    resolveSegmentLink,     // optional: ({ row, segmentKey, segment, value }) => tracked anchor props
    resolveSegmentStrip,    // optional: ({ row, segmentKey, segment, value }) => { parts: [{ key, label, colour, value }] }
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
                    {(hovered.lines || []).map((line) => (
                        <span key={line.key}>
                            <i className="stacked-bar-readout-swatch" style={{ background: line.colour }} />
                            {line.label} {line.valueText}
                        </span>
                    ))}
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
                        const segmentByKey = {};
                        (row.segments || []).forEach((seg) => { segmentByKey[seg.key] = seg; });
                        // Strips (#173) share each segment's order, omission and width; filled while
                        // the track renders so both use one computation.
                        const strips = [];
                        const track = (
                            <div className="stacked-bar-track">
                                {order.map((key) => {
                                    const segment = segmentByKey[key] || {};
                                    const value = segment.value || 0;
                                    if (value <= 0) return null;
                                    const width = denominator > 0 ? (value / denominator) * 100 : 0;
                                    const valueText = formatValue(value);
                                    const segmentLabel = labelFor(key);
                                    const showFull = width >= FULL_SEGMENT_LABEL_MIN_WIDTH;
                                    const readoutData = { rowLabel: row.label, segmentKey: key, segmentLabel, valueText, value };
                                    const segmentLink = resolveSegmentLink
                                        ? resolveSegmentLink({ row, segmentKey: key, segment, value })
                                        : null;
                                    const SegmentControl = segmentLink?.href ? TrackedExternalLink : 'button';
                                    const strip = resolveSegmentStrip
                                        ? resolveSegmentStrip({ row, segmentKey: key, segment, value })
                                        : null;
                                    if (strip) {
                                        const lines = (strip.parts || []).map((part) => ({
                                            key: part.key, label: part.label, colour: part.colour, valueText: formatValue(part.value)
                                        }));
                                        const stripReadout = { ...readoutData, lines };
                                        strips.push(
                                            <div
                                                key={key}
                                                className="stacked-bar-strip"
                                                role="group"
                                                tabIndex={0}
                                                style={{ width: `${Math.max(0, Math.min(100, width))}%` }}
                                                aria-label={[`${row.label} ${segmentLabel}: ${valueText}`,
                                                    ...lines.map((line) => `${line.label} ${line.valueText}`)].join(' · ')}
                                                onMouseEnter={(event) => setHovered(readoutFromPointer(event, stripReadout))}
                                                onMouseMove={(event) => setHovered(readoutFromPointer(event, stripReadout))}
                                                onMouseLeave={() => setHovered(null)}
                                                onFocus={(event) => setHovered(readoutFromElement(event, stripReadout))}
                                                onBlur={() => setHovered(null)}
                                            >
                                                {(strip.parts || []).filter((part) => part.value > 0).map((part) => (
                                                    <span
                                                        key={part.key}
                                                        className="stacked-bar-strip-part"
                                                        style={{ width: `${(part.value / value) * 100}%`, background: part.colour }}
                                                    />
                                                ))}
                                            </div>
                                        );
                                    }
                                    return (
                                        <SegmentControl
                                            key={key}
                                            {...(segmentLink?.href
                                                ? {
                                                    href: segmentLink.href,
                                                    target: '_blank',
                                                    rel: 'noopener noreferrer',
                                                    title: segmentLink.title,
                                                    analyticsMeta: segmentLink.analyticsMeta
                                                  }
                                                : { type: 'button' })}
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
                                            aria-label={segmentLink?.ariaLabel || `${row.label} ${segmentLabel}: ${valueText}`}
                                        >
                                            <span>{showFull ? `${segmentLabel} ${valueText}` : valueText}</span>
                                        </SegmentControl>
                                    );
                                })}
                            </div>
                        );
                        return (
                            <div className="stacked-bar-row" key={row.id}>
                                <div className="stacked-bar-meta">
                                    {renderRowLabel
                                        ? renderRowLabel(row)
                                        : <span className="stacked-bar-row-label">{row.label}</span>}
                                    <strong className="stacked-bar-row-total">{formatValue(row.total)}</strong>
                                </div>
                                {resolveSegmentStrip ? (
                                    <div className="stacked-bar-track-stack">
                                        {track}
                                        <div className="stacked-bar-strips">{strips}</div>
                                    </div>
                                ) : track}
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
