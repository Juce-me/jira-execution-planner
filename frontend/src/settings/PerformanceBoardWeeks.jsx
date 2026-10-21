import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingHoverPosition } from '../ui/hoverBubblePosition.js';
import { count, loadTime, seconds, secondsShort, sizeLabel, weekLabel, weekStartOf } from './performanceFormat.js';

// Weekly view of Board loads. Each column stacks the median of four phases that add up to a load (the server derives
// them, see board_phases in load_performance.py); legend, hover readout and positioning follow ProjectTrackSprintChart.

export const PHASES = [
    { key: 'waitMs', slug: 'wait', label: 'Before first byte' },
    { key: 'indexMs', slug: 'index', label: 'Epic index' },
    { key: 'focusedMs', slug: 'focused', label: 'Focused column' },
    { key: 'restMs', slug: 'rest', label: 'Other columns + render' },
];
const REFERENCES = [[2000, '2s target'], [4000, '4s SLO']];
const CHART_WIDTH = 700;
const CHART_HEIGHT = 316;
const PADDING = { left: 44, right: 92, top: 22, bottom: 60 };
const PLOT_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom;
const MAX_BAR_WIDTH = 60;
const SEGMENT_GAP = 2;
const HOVER_EDGE_GUTTER = 12;
const HOVER_POINTER_GAP = 12;
const HOVER_BUBBLE_WIDTH = 260;
const HOVER_BUBBLE_HEIGHT = 168;
const NICE_MAXIMA = [8000, 12000, 16000, 20000, 30000, 40000, 60000, 120000];

export function niceMaximum(valueMs) {
    const target = valueMs * 1.05;
    return NICE_MAXIMA.find(step => target <= step) || Math.ceil(target / 60000) * 60000;
}

export const phaseTotal = phases => PHASES.reduce((sum, phase) => sum + (phases?.[phase.key] || 0), 0);

function segmentPath(x, top, height, barWidth, rounded) {
    if (!rounded) return `M${x},${top}h${barWidth}v${height}h${-barWidth}z`;
    const radius = Math.min(4, height);
    return `M${x},${top + height}V${top + radius}a${radius},${radius} 0 0 1 ${radius},${-radius}h${barWidth - 2 * radius}a${radius},${radius} 0 0 1 ${radius},${radius}V${top + height}z`;
}

function PerformanceWeekChart({ weeks, selectedWeek, onSelect }) {
    const [hovered, setHovered] = React.useState(null);
    const [isolated, setIsolated] = React.useState(null);
    const maximum = niceMaximum(Math.max(...weeks.map(week => Math.max(week.p95Ms || 0, phaseTotal(week.phases)))));
    const slot = PLOT_WIDTH / weeks.length;
    const barWidth = Math.min(MAX_BAR_WIDTH, slot * 0.6);
    const y = value => PADDING.top + PLOT_HEIGHT - Math.max(0, Math.min(1, value / maximum)) * PLOT_HEIGHT;
    const ticks = [0, 1, 2, 3, 4].map(index => (maximum * index) / 4);
    const showBubble = (event, week) => {
        const boundaryRect = event.currentTarget.ownerSVGElement?.closest?.('.performance-week-chart')?.getBoundingClientRect?.();
        const point = resolveFloatingHoverPosition({
            x: event.clientX, y: event.clientY, boundaryRect, bubbleWidth: HOVER_BUBBLE_WIDTH,
            bubbleHeight: HOVER_BUBBLE_HEIGHT, edgeGutter: HOVER_EDGE_GUTTER, pointerGap: HOVER_POINTER_GAP,
        });
        setHovered({ week, ...point });
    };
    const bubble = hovered ? <div className={`burnout-hover-bubble performance-week-hover-bubble is-${hovered.side || 'right'}`}
        style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}>
        <div className="burnout-hover-title">Week of {weekLabel(hovered.week.weekStart)} · {hovered.week.loads} loads</div>
        {PHASES.map(phase => <div className="burnout-hover-row" key={phase.key}>
            <i className={`burnout-color performance-phase is-${phase.slug}`} />
            <span>{phase.label}: <strong>{seconds(hovered.week.phases[phase.key])}</strong></span>
        </div>)}
        <div className="burnout-hover-row muted"><span>Median <strong>{seconds(hovered.week.medianMs)}</strong> · p95 <strong>{seconds(hovered.week.p95Ms)}</strong></span></div>
        <div className="burnout-hover-row muted"><span>Jira calls {count(hovered.week.medianJiraRequests)} · retries {count(hovered.week.retries)}</span></div>
    </div> : null;
    return <div className="performance-week-chart" onMouseLeave={() => setHovered(null)}>
        <svg className="performance-week-svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img"
            aria-label="Median time per phase of a Board load, by calendar week, with the weekly p95. Exact values follow in the table.">
            {ticks.map(tick => <g key={tick}>
                <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={y(tick)} y2={y(tick)} className="performance-week-grid" />
                <text x={PADDING.left - 8} y={y(tick) + 4} textAnchor="end" className="performance-week-tick">{`${tick / 1000}s`}</text>
            </g>)}
            {REFERENCES.map(([value, label]) => <g key={label} className="performance-reference">
                <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right + 6} y1={y(value)} y2={y(value)} />
                <text x={CHART_WIDTH - PADDING.right + 10} y={y(value) + 4} className="performance-week-tick">{label}</text>
            </g>)}
            {weeks.map((week, index) => {
                const x = PADDING.left + slot * index + (slot - barWidth) / 2;
                const center = x + barWidth / 2;
                let cumulative = 0;
                return <g key={week.weekStart} data-week={week.weekStart}>
                    {PHASES.map((phase, position) => {
                        const value = week.phases[phase.key] || 0;
                        const top = y(cumulative + value) + SEGMENT_GAP;
                        const height = Math.max(0, y(cumulative) - y(cumulative + value) - SEGMENT_GAP);
                        cumulative += value;
                        return <path key={phase.key} d={segmentPath(x, top, height, barWidth, position === PHASES.length - 1)}
                            className={`performance-week-segment performance-phase is-${phase.slug}${isolated && isolated !== phase.key ? ' is-dimmed' : ''}`}
                            data-phase={phase.key} />;
                    })}
                    <rect x={center - 4} y={y(week.p95Ms) - 4} width="8" height="8" transform={`rotate(45 ${center} ${y(week.p95Ms)})`}
                        className="performance-week-p95" />
                    <text x={center} y={CHART_HEIGHT - 40} textAnchor="middle" className="performance-week-label">{weekLabel(week.weekStart)}{week.partial ? '*' : ''}</text>
                    <text x={center} y={CHART_HEIGHT - 24} textAnchor="middle" className="performance-week-label">median {secondsShort(week.medianMs)}</text>
                    <text x={center} y={CHART_HEIGHT - 8} textAnchor="middle" className="performance-week-tick">{week.loads} loads</text>
                    {selectedWeek === week.weekStart && <rect x={x - 6} y={PADDING.top - 4} width={barWidth + 12} height={PLOT_HEIGHT + 8} rx="4" className="performance-week-selection" />}
                    <rect x={PADDING.left + slot * index} y={PADDING.top - 8} width={slot} height={PLOT_HEIGHT + 12} className="performance-week-hit"
                        data-week-hit={week.weekStart}
                        onMouseEnter={event => showBubble(event, week)} onMouseMove={event => showBubble(event, week)}
                        onClick={event => { showBubble(event, week); onSelect(week.weekStart); }} />
                </g>;
            })}
        </svg>
        {bubble && typeof document !== 'undefined' && document.body ? createPortal(bubble, document.body) : bubble}
        <div className="burnout-legend performance-week-legend">
            {PHASES.map(phase => <button type="button" key={phase.key} aria-pressed={isolated === null || isolated === phase.key}
                className={`performance-week-legend-item${isolated && isolated !== phase.key ? ' dimmed' : ''}`}
                onClick={() => setIsolated(current => current === phase.key ? null : phase.key)}>
                <i className={`burnout-color performance-phase is-${phase.slug}`} />{phase.label}
            </button>)}
            <span className="performance-week-p95-key">p95 of the week</span>
        </div>
    </div>;
}

function PerformanceWeekTable({ weeks, selectedWeek, onSelect }) {
    return <details className="performance-methodology" open><summary>Weekly table</summary>
        <div className="performance-table-scroll"><table>
            <thead><tr>
                <th scope="col">Week</th><th scope="col" className="num">Loads</th><th scope="col" className="num">Median</th><th scope="col" className="num">p95</th>
                {PHASES.map(phase => <th scope="col" className="num" key={phase.key}>{phase.label}</th>)}
                <th scope="col" className="num">Jira calls</th><th scope="col" className="num">Retries</th><th scope="col" className="num">Payload</th>
            </tr></thead>
            <tbody>{weeks.map(week => <tr key={week.weekStart} className={week.weekStart === selectedWeek ? 'is-selected' : undefined}>
                <td><button type="button" className="performance-week-pick" aria-pressed={week.weekStart === selectedWeek} onClick={() => onSelect(week.weekStart)}>
                    {weekLabel(week.weekStart)}{week.partial ? ' (so far)' : ''}</button></td>
                <td className="num">{week.loads}</td><td className="num">{seconds(week.medianMs)}</td><td className="num">{seconds(week.p95Ms)}</td>
                {PHASES.map(phase => <td className="num" key={phase.key}>{seconds(week.phases[phase.key])}</td>)}
                <td className="num">{count(week.medianJiraRequests)}</td><td className="num">{count(week.retries)}</td><td className="num">{sizeLabel(week.medianPayloadBytes)}</td>
            </tr>)}</tbody>
        </table></div>
    </details>;
}

function PhaseBar({ phases, total, longest }) {
    return <div className="performance-phase-bar" style={{ width: `${Math.max(12, (total / longest) * 100)}%` }}>
        {PHASES.map(phase => <span key={phase.key} className={`performance-phase is-${phase.slug}`} style={{ flex: phases[phase.key] || 0 }} />)}
    </div>;
}

function loadDetail(sample) {
    const phases = PHASES.map(phase => `${phase.label} ${seconds(sample.phases[phase.key])}`).join(' · ');
    return `${phases}. First focused content ${seconds(sample.firstFocusedContentMs)} · focused column complete ${seconds(sample.focusedCompleteMs)} · ${count(sample.issueCount)} work items · ${count(sample.epicCount)} Epics · ${sizeLabel(sample.payloadBytes)} · ${sample.cacheState || 'unknown'} cache · ${sample.completeness || 'unknown'} · peak child searches ${count(sample.peakChildSearches)} · revision ${sample.revision || 'Unknown'} · ${sample.environment || 'Unknown environment'}`;
}

function PerformanceBoardLoads({ samples, week }) {
    const [sort, setSort] = React.useState({ key: 'time', direction: 'desc' });
    const [expanded, setExpanded] = React.useState(() => new Set());
    const rows = React.useMemo(() => {
        const inWeek = samples.filter(sample => sample.phases && weekStartOf(sample.recordedAt) === week.weekStart);
        const byTime = [...inWeek].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
        if (sort.key === 'total') return [...byTime].sort((a, b) => (sort.direction === 'asc' ? 1 : -1) * (a.durationMs - b.durationMs));
        return sort.direction === 'desc' ? byTime : byTime.reverse();
    }, [samples, week.weekStart, sort]);
    const longest = Math.max(1, ...rows.map(row => row.durationMs));
    const header = (label, key, className) => <th scope="col" className={className}
        aria-sort={sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="performance-sort" onClick={() => setSort(current => current.key === key
            ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' })}>{label}
            {sort.key === key && <span aria-hidden="true">{sort.direction === 'asc' ? ' \u25B2' : ' \u25BC'}</span>}</button></th>;
    const toggle = id => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const showRevisionChange = sort.key === 'time' && sort.direction === 'desc';
    return <>
        <h4>Loads in the week of {weekLabel(week.weekStart)}{week.partial ? ' (so far)' : ''}</h4>
        {rows.length < week.loads && <p className="performance-note" role="status">Showing {rows.length} of {week.loads} loads. The list holds the 200 most recent observations; narrow the filters to see the rest.</p>}
        <div className="performance-table-scroll"><table className="performance-loads">
            <thead><tr><th scope="col" aria-label="Details" />{header('Time (UTC)', 'time')}{header('Total', 'total', 'num')}
                <th scope="col">Where the time went</th><th scope="col" className="num">Jira calls</th><th scope="col" className="num">Retries</th></tr></thead>
            <tbody>{rows.map((row, index) => {
                const open = expanded.has(row.loadId);
                const previous = rows[index - 1];
                return <React.Fragment key={row.loadId}>
                    {showRevisionChange && previous && previous.revision !== row.revision && <tr className="performance-revision-change">
                        <td colSpan={6}>Revision changed: loads above ran on {previous.revision || 'Unknown'}, loads below on {row.revision || 'Unknown'}</td></tr>}
                    <tr>
                        <td><button type="button" className="performance-load-toggle" aria-expanded={open} aria-label="Show details" onClick={() => toggle(row.loadId)}>{open ? '▾' : '▸'}</button></td>
                        <td>{loadTime(row.recordedAt)}</td><td className="num">{seconds(row.durationMs)}</td>
                        <td><PhaseBar phases={row.phases} total={row.durationMs} longest={longest} /></td>
                        <td className="num">{count(row.jiraRequests)}</td><td className="num">{count(row.jiraRetries)}</td>
                    </tr>
                    {open && <tr className="performance-load-detail"><td /><td colSpan={5}>{loadDetail(row)}</td></tr>}
                </React.Fragment>;
            })}</tbody>
        </table></div>
        <p className="performance-note">Before first byte is the time before the server starts streaming (setup, Jira catalog reads, network and the first paint), derived from first focused content minus focused column complete.</p>
    </>;
}

export default function PerformanceBoardWeeks({ weekly, samples = [] }) {
    const weeks = weekly?.weeks || [];
    const [selected, setSelected] = React.useState(null);
    const selectedWeek = weeks.find(week => week.weekStart === selected) || weeks[weeks.length - 1];
    if (weekly?.mixedScopes) return <p role="status">Choose one Scope to see weekly stats: Component and All work loads are different amounts of work.</p>;
    if (!selectedWeek) return <p role="status">No complete Board loads with a phase breakdown in this selection yet.</p>;
    return <>
        <p className="performance-summary">Week of {weekLabel(selectedWeek.weekStart)}{selectedWeek.partial ? ' (so far)' : ''}: median <strong>{seconds(selectedWeek.medianMs)}</strong> · p95 <strong>{seconds(selectedWeek.p95Ms)}</strong> · {selectedWeek.loads} loads · {selectedWeek.breachCount} above 4s · {selectedWeek.errors} errors · {selectedWeek.cancelled} cancelled</p>
        <h4>Where a Board load spends its time, by week</h4>
        <PerformanceWeekChart weeks={weeks} selectedWeek={selectedWeek.weekStart} onSelect={setSelected} />
        <p className="performance-note">{weeks.some(week => week.partial) ? '* current week, still filling. ' : ''}Columns stack each phase's median, so a column can differ slightly from the median load. The diamond is the week's p95 load.</p>
        <PerformanceWeekTable weeks={weeks} selectedWeek={selectedWeek.weekStart} onSelect={setSelected} />
        <PerformanceBoardLoads samples={samples} week={selectedWeek} />
    </>;
}
