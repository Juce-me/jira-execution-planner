import * as React from 'react';

const CHART_WIDTH = 760;
const CHART_HEIGHT = 240;
const PADDING_LEFT = 56;
const PADDING_RIGHT = 24;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 40;
const PLOT_WIDTH = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

const GROUP_LINE_COLOR = '#1f6feb';

function valueFor(point, metric) {
    if (metric === 'storyPoints') return Number(point?.excludedPoints || 0);
    return Number(point?.percent || 0);
}

function formatTick(value, metric, formatPercent, formatExcludedPoints) {
    if (metric === 'storyPoints') return formatExcludedPoints(value);
    return formatPercent(value);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function ExcludedCapacityLineChart({
    series,
    sprints,
    metric,
    mode,
    isolatedSeriesId,
    onSelectSeries,
    resolveTeamColor,
    formatPercent,
    formatExcludedPoints,
    ariaLabel
}) {
    const sprintCount = (sprints || []).length;
    const seriesList = Array.isArray(series) ? series : [];
    const [hoverPoint, setHoverPoint] = React.useState(null);

    const maxValue = React.useMemo(() => {
        const all = [];
        seriesList.forEach(item => {
            (item.points || []).forEach(point => {
                all.push(valueFor(point, metric));
            });
        });
        const max = all.length ? Math.max(...all) : 0;
        if (metric === 'percent') {
            return max <= 0 ? 1 : Math.max(0.05, Math.min(1, max * 1.1));
        }
        if (max <= 0) return 1;
        const niceSteps = [5, 10, 20, 50, 100, 200, 500, 1000];
        const target = max * 1.1;
        for (const step of niceSteps) {
            if (target <= step) return step;
        }
        return Math.ceil(target / 100) * 100;
    }, [seriesList, metric]);

    const yTicks = React.useMemo(() => {
        const count = 4;
        const out = [];
        for (let i = 0; i <= count; i += 1) {
            out.push((maxValue * i) / count);
        }
        return out;
    }, [maxValue]);

    if (sprintCount === 0) {
        return <div className="excluded-capacity-line-empty">Select a sprint range to plot.</div>;
    }

    const xFor = (index) => {
        if (sprintCount === 1) return PADDING_LEFT + PLOT_WIDTH / 2;
        return PADDING_LEFT + (index * PLOT_WIDTH) / (sprintCount - 1);
    };
    const yFor = (value) => {
        const ratio = maxValue > 0 ? value / maxValue : 0;
        const clamped = Math.max(0, Math.min(1, ratio));
        return PADDING_TOP + PLOT_HEIGHT - clamped * PLOT_HEIGHT;
    };

    const colorFor = (entry) => {
        if (mode === 'group') return GROUP_LINE_COLOR;
        return resolveTeamColor ? resolveTeamColor(entry.seriesId) : '#1f6feb';
    };
    const valueTextFor = (point) => {
        if (metric === 'storyPoints') return `${formatExcludedPoints(valueFor(point, metric))} SP`;
        return formatPercent(valueFor(point, metric));
    };
    const detailTextFor = (point) => {
        const crossPoints = formatExcludedPoints(point?.excludedPoints || 0);
        const totalPoints = formatExcludedPoints(point?.totalPoints || 0);
        if (metric === 'storyPoints') {
            return `${formatPercent(point?.percent || 0)} of total (${crossPoints} / ${totalPoints} SP)`;
        }
        return `${crossPoints} cross SP / ${totalPoints} total SP`;
    };
    const resolveHoverPoint = (event) => {
        const svg = event.currentTarget.ownerSVGElement;
        const rect = svg?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        const localX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
        const localY = ((event.clientY - rect.top) / rect.height) * CHART_HEIGHT;
        if (
            localX < PADDING_LEFT ||
            localX > CHART_WIDTH - PADDING_RIGHT ||
            localY < PADDING_TOP ||
            localY > CHART_HEIGHT - PADDING_BOTTOM
        ) {
            return null;
        }
        const rawIndex = sprintCount === 1
            ? 0
            : Math.round(((localX - PADDING_LEFT) / PLOT_WIDTH) * (sprintCount - 1));
        const pointIndex = clamp(rawIndex, 0, sprintCount - 1);
        let nearest = null;
        seriesList.forEach(entry => {
            if (isolatedSeriesId && isolatedSeriesId !== entry.seriesId) return;
            const point = (entry.points || [])[pointIndex];
            if (!point) return;
            const value = valueFor(point, metric);
            const y = yFor(value);
            const distance = Math.abs(y - localY);
            if (!nearest || distance < nearest.distance) {
                const x = xFor(pointIndex);
                nearest = {
                    distance,
                    seriesId: entry.seriesId,
                    label: entry.label,
                    color: colorFor(entry),
                    pointIndex,
                    sprintName: point.sprintName || point.sprintId || '',
                    x,
                    y,
                    leftPercent: clamp((x / CHART_WIDTH) * 100, 10, 90),
                    topPercent: clamp((y / CHART_HEIGHT) * 100, 12, 78),
                    valueText: valueTextFor(point),
                    detailText: detailTextFor(point)
                };
            }
        });
        return nearest;
    };

    const tickLabelEvery = sprintCount <= 8 ? 1 : Math.ceil(sprintCount / 6);
    const chartAriaLabel = ariaLabel || (mode === 'group' ? 'Group excluded capacity over sprints' : 'Excluded capacity per team over sprints');

    return (
        <div className="excluded-capacity-line-chart" onMouseLeave={() => setHoverPoint(null)}>
            <svg
                className="excluded-capacity-line-svg"
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={chartAriaLabel}
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
                                className="excluded-capacity-line-grid"
                            />
                            <text
                                x={PADDING_LEFT - 8}
                                y={y + 4}
                                className="excluded-capacity-line-tick"
                                textAnchor="end"
                            >
                                {formatTick(tick, metric, formatPercent, formatExcludedPoints)}
                            </text>
                        </g>
                    );
                })}
                {(sprints || []).map((sprint, index) => {
                    if (index % tickLabelEvery !== 0 && index !== sprintCount - 1) return null;
                    const label = sprint.sprintName || sprint.sprintId || '';
                    return (
                        <text
                            key={sprint.sprintId || index}
                            x={xFor(index)}
                            y={CHART_HEIGHT - PADDING_BOTTOM + 16}
                            className="excluded-capacity-line-axis"
                            textAnchor="middle"
                        >
                            {label}
                        </text>
                    );
                })}
                <line
                    x1={PADDING_LEFT}
                    x2={CHART_WIDTH - PADDING_RIGHT}
                    y1={yFor(0)}
                    y2={yFor(0)}
                    className="excluded-capacity-line-axis-line"
                />
                {seriesList.map((entry) => {
                    const color = colorFor(entry);
                    const isIsolated = isolatedSeriesId === entry.seriesId;
                    const isDimmed = Boolean(isolatedSeriesId && !isIsolated);
                    const path = (entry.points || [])
                        .map((point, idx) => {
                            const x = xFor(idx);
                            const y = yFor(valueFor(point, metric));
                            return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                        })
                        .join(' ');
                    return (
                        <g
                            key={entry.seriesId}
                            className={`excluded-capacity-line-series${isDimmed ? ' is-dimmed' : ''}${isIsolated ? ' is-isolated' : ''}`}
                            opacity={isDimmed ? 0.18 : 1}
                        >
                            <path d={path} stroke={color} fill="none" strokeWidth={isIsolated ? 2.5 : 2} />
                            {(entry.points || []).map((point, idx) => {
                                const value = valueFor(point, metric);
                                return (
                                    <circle
                                        key={`${entry.seriesId}-${point.sprintId || idx}`}
                                        className="excluded-capacity-line-point"
                                        cx={xFor(idx)}
                                        cy={yFor(value)}
                                        r={isIsolated ? 3.5 : 3}
                                        fill={color}
                                    />
                                );
                            })}
                        </g>
                    );
                })}
                <rect
                    className="excluded-capacity-line-hover-capture"
                    x={PADDING_LEFT}
                    y={PADDING_TOP}
                    width={PLOT_WIDTH}
                    height={PLOT_HEIGHT}
                    onMouseMove={(event) => {
                        const nextPoint = resolveHoverPoint(event);
                        setHoverPoint(nextPoint);
                    }}
                />
                {hoverPoint && (
                    <g className="excluded-capacity-line-hover-marker">
                        <line
                            className="excluded-capacity-line-hover-line"
                            x1={hoverPoint.x}
                            x2={hoverPoint.x}
                            y1={PADDING_TOP}
                            y2={CHART_HEIGHT - PADDING_BOTTOM}
                        />
                        <circle
                            className="excluded-capacity-line-point is-hovered"
                            cx={hoverPoint.x}
                            cy={hoverPoint.y}
                            r={4.5}
                            fill={hoverPoint.color}
                        />
                    </g>
                )}
            </svg>
            {hoverPoint && (
                <div
                    className="burnout-hover-bubble excluded-capacity-line-hover-bubble"
                    style={{
                        left: `${hoverPoint.leftPercent}%`,
                        top: `${hoverPoint.topPercent}%`
                    }}
                >
                    <div className="burnout-hover-title">{hoverPoint.sprintName}</div>
                    <div className="burnout-hover-row">
                        <i className="burnout-color" style={{ background: hoverPoint.color }} />
                        <span>{hoverPoint.label}: <strong>{hoverPoint.valueText}</strong></span>
                    </div>
                    <div className="burnout-hover-row muted">{hoverPoint.detailText}</div>
                </div>
            )}
            <div className="burnout-legend excluded-capacity-line-legend">
                {seriesList.length === 0 && <span className="excluded-capacity-line-empty">No data in range.</span>}
                {seriesList.map((entry) => {
                    const color = colorFor(entry);
                    const isIsolated = isolatedSeriesId === entry.seriesId;
                    const isDimmed = isolatedSeriesId && isolatedSeriesId !== entry.seriesId;
                    return (
                        <button
                            type="button"
                            key={entry.seriesId}
                            className={`excluded-capacity-line-legend-item${isIsolated ? ' is-isolated' : ''}${isDimmed ? ' dimmed' : ''}`}
                            onClick={() => onSelectSeries && onSelectSeries(isIsolated ? null : entry.seriesId)}
                            aria-label={isIsolated ? 'Show all teams' : `Show only ${entry.label}`}
                        >
                            <i className="burnout-color" style={{ background: color }} />
                            {entry.label}
                        </button>
                    );
                })}
                {isolatedSeriesId && (
                    <button
                        type="button"
                        className="excluded-capacity-line-legend-reset"
                        onClick={() => onSelectSeries && onSelectSeries(null)}
                    >
                        Show all
                    </button>
                )}
            </div>
        </div>
    );
}

export default ExcludedCapacityLineChart;
