import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingHoverPosition } from '../ui/hoverBubblePosition.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';
import { segmentAtFraction } from './stackedBarHitTest.js';

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
// Strip layers: a tinted layer is the segment colour at this strength over the surface (opaque, so it reads the same over
// the track, the fill or a solid layer).
const STRIP_TINT_PERCENT = 45;
const tintOf = colour => `color-mix(in srgb, ${colour} ${STRIP_TINT_PERCENT}%, var(--bg-secondary))`;

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

// Extra lines beyond the two the base height covers: strip lines, or a formatted readout's declared line count.
const extraLines = readout => readout.extraLines ?? (readout.lines?.length || 0);

function readoutFromPointer(event, readout) {
    const point = clampReadoutPoint(event.clientX, event.clientY, extraLines(readout));
    return { ...readout, ...point };
}

function readoutFromElement(event, readout) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = clampReadoutPoint(rect.left + (rect.width / 2), rect.top, extraLines(readout));
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
    emptyText = 'No data in range.',
    variant,                // optional: 'strip' = 5px label-less strip (.stacked-bar--strip), e.g. the Planning assignee underbar.
                            // Strip segments may carry two layers of their colour: `tint: true` paints the segment (the base,
                            // `value` wide) tinted, and `overlay: { value, tint }` is drawn ON TOP of it from its left edge,
                            // `overlay.value` wide, solid or tinted. Hit testing and readouts still see one segment.
    readoutLineCount        // optional: ({ segmentKey }) => lines of formatReadout's output, so the readout clamps inside the viewport
}) {
    const rowList = Array.isArray(rows) ? rows : [];
    const order = Array.isArray(segmentOrder) ? segmentOrder : [];
    const [hovered, setHovered] = React.useState(null);
    const labelFor = (key) => (resolveLabel ? resolveLabel(key) : key);
    const isStrip = variant === 'strip';
    // Strip variant: the whole element (its wrapper sizes it to the host track) takes the pointer and resolves the
    // segment at the pointer's x on the first row, `row.total` wide (an axis wider than the segments is allowed);
    // past the last segment formatReadout gets `segmentKey: null`. A tap arrives as a click at the same x.
    const trackReadout = (event) => {
        const row = rowList[0];
        const rect = event.currentTarget.getBoundingClientRect();
        if (!row || !(rect.width > 0)) return null;
        const segmentKey = segmentAtFraction(row.segments, order, row.total || 0, (event.clientX - rect.left) / rect.width);
        if (segmentKey === null && !formatReadout) return null;
        const value = segmentKey === null ? 0 : (row.segments.find((seg) => seg.key === segmentKey)?.value || 0);
        const lineCount = readoutLineCount ? readoutLineCount({ segmentKey }) : 2;
        return readoutFromPointer(event, {
            rowLabel: row.label, segmentKey, value, segmentLabel: segmentKey === null ? '' : labelFor(segmentKey),
            valueText: formatValue(value), extraLines: Math.max(0, lineCount - 2)
        });
    };
    const stripHandlers = isStrip ? {
        onMouseEnter: (event) => setHovered(trackReadout(event)),
        onMouseMove: (event) => setHovered(trackReadout(event)),
        onMouseLeave: () => setHovered(null),
        onClick: (event) => setHovered(trackReadout(event))
    } : {};

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
        <div className={isStrip ? 'stacked-bar stacked-bar--strip' : 'stacked-bar'} role="group" aria-label={ariaLabel} {...stripHandlers}>
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
                                    const readoutData = { rowLabel: row.label, segmentKey: key, segmentLabel, valueText, value,
                                        ...(readoutLineCount ? { extraLines: Math.max(0, readoutLineCount({ segmentKey: key }) - 2) } : {}) };
                                    const colour = resolveColor ? resolveColor(key) : '#94a3b8';
                                    const overlay = isStrip && segment.overlay?.value > 0 ? segment.overlay : null;
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
                                                '--stacked-bar-color': isStrip && segment.tint ? tintOf(colour) : colour
                                            }}
                                            tabIndex={0}
                                            {...(isStrip ? {} : {
                                                onMouseEnter: (event) => setHovered(readoutFromPointer(event, readoutData)),
                                                onMouseMove: (event) => setHovered(readoutFromPointer(event, readoutData)),
                                                onMouseLeave: () => setHovered(null),
                                                onClick: (event) => setHovered(readoutFromElement(event, readoutData))
                                            })}
                                            onFocus={(event) => setHovered(readoutFromElement(event, readoutData))}
                                            onBlur={() => setHovered(null)}
                                            aria-label={segmentLink?.ariaLabel || `${row.label} ${segmentLabel}: ${valueText}`}
                                        >
                                            <span>{showFull ? `${segmentLabel} ${valueText}` : valueText}</span>
                                            {overlay && <span className="stacked-bar-strip-part" aria-hidden="true"
                                                style={{ width: `${Math.min(100, (overlay.value / value) * 100)}%`, background: overlay.tint ? tintOf(colour) : colour }} />}
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
