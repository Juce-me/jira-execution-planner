import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingHoverPosition } from '../ui/hoverBubblePosition.js';
import { REFERENCES, niceMaximum } from './PerformanceBoardWeeks.jsx';
import { seconds, weekLabel } from './performanceFormat.js';

// Weekly view of Catch Up loads: average, median and p95 per week for two measurements (the server derives them, see
// _catch_up_weekly in load_performance.py); legend, hover readout and positioning follow the Board weekly chart.
// PerformanceWeeksView is shared with the EPM weekly view (PerformanceEpmWeeks.jsx), which passes its own config:
// { label, metrics, notes, about, extras(week), table(weeks) }.

export const SERIES = [
    { key: 'avgMs', slug: 'avg', label: 'Average' },
    { key: 'medianMs', slug: 'median', label: 'Median' },
    { key: 'p95Ms', slug: 'p95', label: 'p95' },
];
export const METRICS = [
    { key: 'listLoaded', countKey: 'listLoads', title: 'List loaded' },
    { key: 'fullyLoaded', countKey: 'loads', title: 'Fully loaded' },
];
export const PRELIMINARY_LOADS = 20;
const NOTES = {
    listLoaded: 'Time until both the Product and Tech issue lists arrive (the slower of the two). Counts a load even when its dependency request failed or it was cancelled afterwards. Measured from the start of the data requests; downloading and starting the app is not included.',
    fullyLoaded: 'Time until the issue lists and the requested dependencies have loaded and painted. Successful loads only.',
};
const ABOUT = [
    'Weeks are UTC calendar weeks starting Monday. * marks a partial week: the current week is still filling, and the oldest week can begin before the 30-day window. Neither measurement includes the readiness check or alerts.',
    'Each week blends every revision, cache state, Sprint and Group in the current selection; Cache hit shows how much of the week was served from cache. Use the Group, Sprint and Revision filters to compare like with like.',
    `Fewer than ${PRELIMINARY_LOADS} loads in a week is preliminary: its p95 is close to the slowest load.`,
    'With dependencies hidden or skipped, Fully loaded ends with the lists.',
];
const CHART_WIDTH = 700;
const CHART_HEIGHT = 260;
const PADDING = { left: 44, right: 92, top: 22, bottom: 46 };
const PLOT_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom;
const HOVER_EDGE_GUTTER = 12;
const HOVER_POINTER_GAP = 12;
const HOVER_BUBBLE_WIDTH = 260;
const HOVER_BUBBLE_HEIGHT = 144;
const REFERENCE_LABEL_GAP = 12;   // viewBox units between the two reference label baselines: more than the 9px tick text height

const weekName = week => `${weekLabel(week.weekStart)}${week.partial ? '*' : ''}`;
const share = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'Unknown';
const valueOf = (week, metric, series) => (Number.isFinite(week[metric.key]?.[series.key]) ? week[metric.key][series.key] : null);
const utcDay = weekStart => {
    const [year, month, day] = weekStart.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
};

function marker(series, x, y, value, className) {
    const props = { className, 'data-point': series.key, 'data-value': value };
    if (series.slug === 'avg') return <circle key={series.key} cx={x} cy={y} r="4" {...props} />;
    if (series.slug === 'median') return <rect key={series.key} x={x - 3.5} y={y - 3.5} width="7" height="7" {...props} />;
    return <rect key={series.key} x={x - 4} y={y - 4} width="8" height="8" transform={`rotate(45 ${x} ${y})`} {...props} />;
}

export function PerformanceLineChart({ weeks, metric, isolated, config }) {
    const [hovered, setHovered] = React.useState(null);
    const values = weeks.flatMap(week => SERIES.map(series => valueOf(week, metric, series))).filter(value => value !== null);
    const maximum = niceMaximum(Math.max(...values));
    const slot = PLOT_WIDTH / weeks.length;
    const center = index => PADDING.left + slot * index + slot / 2;
    const y = value => PADDING.top + PLOT_HEIGHT - Math.max(0, Math.min(1, value / maximum)) * PLOT_HEIGHT;
    const ticks = [0, 1, 2, 3, 4].map(index => (maximum * index) / 4);
    const dimmed = series => (isolated && isolated !== series.key ? ' is-dimmed' : '');
    const runs = series => weeks.reduce((all, week, index) => {
        const value = valueOf(week, metric, series);
        // The server returns only weeks with rows: a missing calendar week breaks the line like an empty one.
        if (value === null || (index > 0 && utcDay(week.weekStart) - utcDay(weeks[index - 1].weekStart) > 7)) all.push([]);
        if (value !== null) all[all.length - 1].push(`${center(index)},${y(value)}`);
        return all;
    }, [[]]).filter(run => run.length >= 2);
    // On a large axis the 2s and 4s lines nearly meet: move the 2s label down and the 4s label up by the same amount.
    const [targetBaseline, sloBaseline] = REFERENCES.map(([value]) => y(value) + 4);
    const nudge = Math.max(0, (REFERENCE_LABEL_GAP - (targetBaseline - sloBaseline)) / 2);
    const showBubble = (event, week) => {
        const boundaryRect = event.currentTarget.ownerSVGElement?.closest?.('.performance-week-chart')?.getBoundingClientRect?.();
        const point = resolveFloatingHoverPosition({
            x: event.clientX, y: event.clientY, boundaryRect, bubbleWidth: HOVER_BUBBLE_WIDTH,
            bubbleHeight: HOVER_BUBBLE_HEIGHT, edgeGutter: HOVER_EDGE_GUTTER, pointerGap: HOVER_POINTER_GAP,
        });
        setHovered({ week, ...point });
    };
    const loads = hovered ? hovered.week[metric.countKey] : 0;
    const bubble = hovered ? <div className={`burnout-hover-bubble performance-week-hover-bubble is-${hovered.side || 'right'}`}
        style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}>
        <div className="burnout-hover-title">Week of {weekLabel(hovered.week.weekStart)} · {loads} loads</div>
        {SERIES.map(series => <div className="burnout-hover-row" key={series.key}>
            <i className={`burnout-color performance-phase is-${series.slug}`} />
            <span>{series.label}: <strong>{seconds(valueOf(hovered.week, metric, series))}</strong></span>
        </div>)}
        <div className="burnout-hover-row muted performance-week-counts"><span>{config.extras(hovered.week)}</span></div>
        {loads < PRELIMINARY_LOADS && <div className="burnout-hover-row muted"><span>Preliminary: fewer than {PRELIMINARY_LOADS} loads</span></div>}
    </div> : null;
    return <div className="performance-week-chart" onMouseLeave={() => setHovered(null)}>
        <svg className="performance-week-svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} data-chart={metric.key} role="img"
            aria-label={`Weekly average, median and p95 of ${metric.title} time for ${config.label}. Exact values follow in the table.`}>
            {ticks.map(tick => <g key={tick}>
                <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={y(tick)} y2={y(tick)} className="performance-week-grid" />
                <text x={PADDING.left - 8} y={y(tick) + 4} textAnchor="end" className="performance-week-tick">{`${tick / 1000}s`}</text>
            </g>)}
            {REFERENCES.map(([value, label], index) => <g key={label} className="performance-reference">
                <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right + 6} y1={y(value)} y2={y(value)} />
                <text x={CHART_WIDTH - PADDING.right + 10} y={index === 0 ? targetBaseline + nudge : sloBaseline - nudge} className="performance-week-tick">{label}</text>
            </g>)}
            {SERIES.flatMap(series => runs(series).map(run => <polyline key={`${series.key}-${run[0]}`} points={run.join(' ')}
                className={`performance-line-path performance-phase is-${series.slug}${dimmed(series)}`} data-series={series.key} />))}
            {weeks.map((week, index) => <g key={week.weekStart} data-week={week.weekStart}>
                {SERIES.map(series => {
                    const value = valueOf(week, metric, series);
                    return value === null ? null
                        : marker(series, center(index), y(value), value, `performance-line-point performance-phase is-${series.slug}${dimmed(series)}`);
                })}
                <text x={center(index)} y={CHART_HEIGHT - 24} textAnchor="middle" className="performance-week-label">{weekName(week)}</text>
                <text x={center(index)} y={CHART_HEIGHT - 8} textAnchor="middle" className="performance-week-tick">{`${week[metric.countKey]} loads`}</text>
                <rect x={PADDING.left + slot * index} y={PADDING.top - 8} width={slot} height={PLOT_HEIGHT + 12} className="performance-week-hit"
                    data-week-hit={week.weekStart}
                    onMouseEnter={event => showBubble(event, week)} onMouseMove={event => showBubble(event, week)}
                    onClick={event => showBubble(event, week)} />
            </g>)}
        </svg>
        {bubble && typeof document !== 'undefined' && document.body ? createPortal(bubble, document.body) : bubble}
    </div>;
}

function PerformanceCatchUpTable({ weeks }) {
    const metricCells = (week, metric) => <>
        <td className="num">{week[metric.countKey]}</td>
        {SERIES.map(series => <td className="num" key={series.key}>{seconds(valueOf(week, metric, series))}</td>)}
    </>;
    return <details className="performance-methodology" open><summary>Weekly table</summary>
        <div className="performance-table-scroll"><table>
            <thead><tr>
                <th scope="col">Week</th>
                <th scope="col" className="num">List loads</th><th scope="col" className="num">List avg</th><th scope="col" className="num">List median</th><th scope="col" className="num">List p95</th>
                <th scope="col" className="num">Full loads</th><th scope="col" className="num">Full avg</th><th scope="col" className="num">Full median</th><th scope="col" className="num">Full p95</th>
                <th scope="col" className="num">Cache hit</th><th scope="col" className="num">Errors</th><th scope="col" className="num">Cancelled</th><th scope="col" className="num">Capped</th>
            </tr></thead>
            <tbody>{weeks.map(week => <tr key={week.weekStart}>
                <td>{weekName(week)}</td>
                {METRICS.map(metric => <React.Fragment key={metric.key}>{metricCells(week, metric)}</React.Fragment>)}
                <td className="num">{share(week.cacheHitShare)}</td><td className="num">{week.errors}</td><td className="num">{week.cancelled}</td><td className="num">{week.capped}</td>
            </tr>)}</tbody>
        </table></div>
    </details>;
}

const CATCH_UP_CONFIG = {
    label: 'Catch Up', metrics: METRICS, notes: NOTES, about: ABOUT, table: weeks => <PerformanceCatchUpTable weeks={weeks} />,
    extras: week => `Errors ${week.errors} · cancelled ${week.cancelled} · capped ${week.capped} · cache hit ${share(week.cacheHitShare)}`,
};

export function PerformanceWeeksView({ weeks, config }) {
    const [isolated, setIsolated] = React.useState(null);
    if (!weeks.length) return <p role="status">No {config.label} loads in this selection yet.</p>;
    return <section aria-label={`${config.label} weekly load times`}>
        <div className="burnout-legend performance-week-legend">
            {SERIES.map(series => <button type="button" key={series.key} aria-pressed={isolated === null || isolated === series.key}
                className={`performance-week-legend-item${isolated && isolated !== series.key ? ' dimmed' : ''}`}
                onClick={() => setIsolated(current => current === series.key ? null : series.key)}>
                <i className={`burnout-color performance-phase is-${series.slug}`} />{series.label}
            </button>)}
        </div>
        {config.metrics.map(metric => <React.Fragment key={metric.key}>
            <h4>{metric.title}, by week</h4>
            <p className="performance-note">{config.notes[metric.key]}</p>
            {weeks.some(week => week[metric.countKey] > 0)
                ? <PerformanceLineChart weeks={weeks} metric={metric} isolated={isolated} config={config} />
                : <p role="status" className="performance-note">No loads in this selection reached this measurement yet.</p>}
        </React.Fragment>)}
        {config.table(weeks)}
        <details className="performance-methodology"><summary>About the weekly charts</summary>
            {config.about.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        </details>
    </section>;
}

export default function PerformanceCatchUpWeeks({ weekly }) {
    return <PerformanceWeeksView weeks={weekly?.weeks || []} config={CATCH_UP_CONFIG} />;
}
