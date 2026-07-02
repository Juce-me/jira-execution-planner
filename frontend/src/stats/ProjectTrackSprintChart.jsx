import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingHoverPosition } from '../ui/hoverBubblePosition.js';

// Vertical per-sprint stacked-bar chart, modeled on ExcludedCapacityLineChart.jsx for
// sizing, Y ticks, the native-button legend, and resolveFloatingHoverPosition. Each
// sprint is a column stacked by track; hovering a segment shows "{sprint} — {track}: {n} SP".
// No bar selection.

const CHART_WIDTH = 760;
const CHART_HEIGHT = 240;
const PADDING_LEFT = 56;
const PADDING_RIGHT = 24;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 40;
const PLOT_WIDTH = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const HOVER_EDGE_GUTTER = 12;
const HOVER_POINTER_GAP = 12;
const HOVER_BUBBLE_WIDTH = 260;
const HOVER_BUBBLE_HEIGHT = 72;
const MAX_BAR_WIDTH = 64;

function clampHoverBubblePoint(x, y, boundaryRect = null) {
    return resolveFloatingHoverPosition({
        x,
        y,
        boundaryRect,
        bubbleWidth: HOVER_BUBBLE_WIDTH,
        bubbleHeight: HOVER_BUBBLE_HEIGHT,
        edgeGutter: HOVER_EDGE_GUTTER,
        pointerGap: HOVER_POINTER_GAP
    });
}

function formatPoints(value) {
    const num = Number(value || 0);
    const rounded = Math.round(num * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function niceMax(rawMax) {
    if (rawMax <= 0) return 1;
    const target = rawMax * 1.1;
    const niceSteps = [5, 10, 20, 50, 100, 200, 500, 1000];
    for (const step of niceSteps) {
        if (target <= step) return step;
    }
    return Math.ceil(target / 100) * 100;
}

export default function ProjectTrackSprintChart({ series, resolveColor, caption }) {
    const sprints = Array.isArray(series?.sprints) ? series.sprints : [];
    const tracks = Array.isArray(series?.tracks) ? series.tracks : [];
    const cells = series?.cells || {};
    const sprintLabels = series?.sprintLabels || {};
    const sprintCount = sprints.length;
    const [hovered, setHovered] = React.useState(null);

    const maxValue = React.useMemo(() => {
        let max = 0;
        sprints.forEach((id) => {
            const col = cells[id] || {};
            const total = tracks.reduce((sum, track) => sum + (col[track] || 0), 0);
            if (total > max) max = total;
        });
        return niceMax(max);
    }, [sprints, tracks, cells]);

    const yTicks = React.useMemo(() => {
        const count = 4;
        const out = [];
        for (let i = 0; i <= count; i += 1) out.push((maxValue * i) / count);
        return out;
    }, [maxValue]);

    if (sprintCount === 0) {
        return <div className="project-track-sprint-empty">Select a sprint range to plot.</div>;
    }

    const slot = PLOT_WIDTH / sprintCount;
    const barWidth = Math.min(MAX_BAR_WIDTH, slot * 0.6);
    const centerX = (index) => PADDING_LEFT + slot * (index + 0.5);
    const yFor = (value) => {
        const ratio = maxValue > 0 ? value / maxValue : 0;
        return PADDING_TOP + PLOT_HEIGHT - Math.max(0, Math.min(1, ratio)) * PLOT_HEIGHT;
    };
    const tickLabelEvery = sprintCount <= 8 ? 1 : Math.ceil(sprintCount / 6);

    const hoverBubble = hovered ? (
        <div
            className={`burnout-hover-bubble project-track-sprint-hover-bubble is-${hovered.side || 'right'}`}
            style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}
        >
            <div className="burnout-hover-title">{hovered.sprintLabel}</div>
            <div className="burnout-hover-row">
                <i className="burnout-color" style={{ background: hovered.color }} />
                <span>{hovered.track}: <strong>{hovered.valueText} SP</strong></span>
            </div>
        </div>
    ) : null;

    const onSegmentHover = (event, payload) => {
        const svg = event.currentTarget.ownerSVGElement;
        const boundaryRect = svg?.closest?.('.project-track-sprint-chart')?.getBoundingClientRect?.();
        const point = clampHoverBubblePoint(event.clientX, event.clientY, boundaryRect);
        setHovered({ ...payload, ...point });
    };

    return (
        <div className="project-track-sprint-chart" onMouseLeave={() => setHovered(null)}>
            <svg
                className="project-track-sprint-svg"
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label="Story points by project track per sprint"
            >
                {yTicks.map((tick, index) => {
                    const y = yFor(tick);
                    return (
                        <g key={`grid-${index}`}>
                            <line
                                x1={PADDING_LEFT}
                                x2={CHART_WIDTH - PADDING_RIGHT}
                                y1={y}
                                y2={y}
                                className="project-track-sprint-grid"
                            />
                            <text
                                x={PADDING_LEFT - 8}
                                y={y + 4}
                                className="project-track-sprint-tick"
                                textAnchor="end"
                            >
                                {formatPoints(tick)}
                            </text>
                        </g>
                    );
                })}
                <line
                    x1={PADDING_LEFT}
                    x2={CHART_WIDTH - PADDING_RIGHT}
                    y1={yFor(0)}
                    y2={yFor(0)}
                    className="project-track-sprint-axis-line"
                />
                {sprints.map((id, index) => {
                    const col = cells[id] || {};
                    const label = sprintLabels[id] || id;
                    let cumulative = 0;
                    return (
                        <g key={id}>
                            {tracks.map((track) => {
                                const value = col[track] || 0;
                                if (value <= 0) return null;
                                const yTop = yFor(cumulative + value);
                                const yBottom = yFor(cumulative);
                                cumulative += value;
                                const height = Math.max(0, yBottom - yTop);
                                const color = resolveColor ? resolveColor(track) : '#94a3b8';
                                const payload = {
                                    sprintLabel: label,
                                    track,
                                    color,
                                    valueText: formatPoints(value)
                                };
                                return (
                                    <rect
                                        key={`${id}-${track}`}
                                        className="project-track-sprint-segment"
                                        x={centerX(index) - barWidth / 2}
                                        y={yTop}
                                        width={barWidth}
                                        height={height}
                                        fill={color}
                                        onMouseEnter={(event) => onSegmentHover(event, payload)}
                                        onMouseMove={(event) => onSegmentHover(event, payload)}
                                        onMouseLeave={() => setHovered(null)}
                                    >
                                        <title>{`${label} — ${track}: ${formatPoints(value)} SP`}</title>
                                    </rect>
                                );
                            })}
                            {(index % tickLabelEvery === 0 || index === sprintCount - 1) && (
                                <text
                                    x={centerX(index)}
                                    y={CHART_HEIGHT - PADDING_BOTTOM + 16}
                                    className="project-track-sprint-axis"
                                    textAnchor="middle"
                                >
                                    {label}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
            {hoverBubble && typeof document !== 'undefined' && document.body
                ? createPortal(hoverBubble, document.body)
                : hoverBubble}
            {caption && <div className="project-track-sprint-caption">{caption}</div>}
            <div className="burnout-legend project-track-sprint-legend">
                {tracks.length === 0 && <span className="project-track-sprint-empty">No data in range.</span>}
                {tracks.map((track) => (
                    <button
                        type="button"
                        className="project-track-sprint-legend-item"
                        key={track}
                        aria-label={`Project track ${track}`}
                    >
                        <i className="burnout-color" style={{ background: resolveColor ? resolveColor(track) : '#94a3b8' }} />
                        {track}
                    </button>
                ))}
            </div>
        </div>
    );
}
