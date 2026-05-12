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

function ExcludedCapacityLineChart({
    series,
    sprints,
    metric,
    mode,
    isolatedSeriesId,
    onSelectSeries,
    resolveTeamColor,
    formatPercent,
    formatExcludedPoints
}) {
    const sprintCount = (sprints || []).length;
    const seriesList = Array.isArray(series) ? series : [];

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

    const tickLabelEvery = sprintCount <= 8 ? 1 : Math.ceil(sprintCount / 6);

    return (
        <div className="excluded-capacity-line-chart">
            <svg
                className="excluded-capacity-line-svg"
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={mode === 'group' ? 'Group excluded capacity over sprints' : 'Excluded capacity per team over sprints'}
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
                                const tooltip = `${entry.label} · ${point.sprintName || point.sprintId}: ${
                                    metric === 'storyPoints'
                                        ? `${formatExcludedPoints(point.excludedPoints)} / ${formatExcludedPoints(point.totalPoints)} SP`
                                        : `${formatPercent(point.percent)} (${formatExcludedPoints(point.excludedPoints)} / ${formatExcludedPoints(point.totalPoints)} SP)`
                                }`;
                                return (
                                    <circle
                                        key={`${entry.seriesId}-${point.sprintId || idx}`}
                                        cx={xFor(idx)}
                                        cy={yFor(value)}
                                        r={isIsolated ? 3.5 : 3}
                                        fill={color}
                                    >
                                        <title>{tooltip}</title>
                                    </circle>
                                );
                            })}
                        </g>
                    );
                })}
            </svg>
            <div className="burnout-legend excluded-capacity-line-legend">
                {seriesList.length === 0 && <span className="excluded-capacity-line-empty">No data in range.</span>}
                {seriesList.map((entry) => {
                    const color = colorFor(entry);
                    const isIsolated = isolatedSeriesId === entry.seriesId;
                    const isDimmed = isolatedSeriesId && isolatedSeriesId !== entry.seriesId;
                    return (
                        <span
                            key={entry.seriesId}
                            className={`excluded-capacity-line-legend-item${isIsolated ? ' is-isolated' : ''}${isDimmed ? ' dimmed' : ''}`}
                            onClick={() => onSelectSeries && onSelectSeries(isIsolated ? null : entry.seriesId)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    onSelectSeries && onSelectSeries(isIsolated ? null : entry.seriesId);
                                }
                            }}
                            title={isIsolated ? 'Show all teams' : `Show only ${entry.label}`}
                        >
                            <i className="burnout-color" style={{ background: color }} />
                            {entry.label}
                        </span>
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
