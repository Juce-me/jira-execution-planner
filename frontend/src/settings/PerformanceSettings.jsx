import * as React from 'react';
import { fetchAdminPerformance } from '../api/performanceApi.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';

const seconds = value => Number.isFinite(value) ? `${(value / 1000).toFixed(2)}s` : 'Unknown';
const count = value => Number.isFinite(value) ? value : 'Unknown';

export function PerformanceTrend({ trend = [] }) {
    const rows = trend.filter(row => Number.isFinite(row.avgMs) && Number.isFinite(row.p95Ms));
    if (!rows.length) return <p>No successful non-capped loads in this selection yet.</p>;
    const maximum = Math.max(5000, ...rows.map(row => Math.max(row.avgMs, row.p95Ms))) * 1.1;
    const y = value => 176 - value / maximum * 152;
    const x = index => rows.length === 1 ? 340 : 60 + index / (rows.length - 1) * 560;
    return <div className="performance-trend">
        <svg viewBox="0 0 680 210" role="img" aria-label="Daily average and p95 selected group load duration. Exact values follow in the table.">
            {[2000, 4000].map(value => <g key={value} className="performance-reference">
                <line x1="60" x2="620" y1={y(value)} y2={y(value)} />
                <text x="64" y={y(value) - 5}>{value === 2000 ? '2s target' : '4s SLO'}</text>
            </g>)}
            <text x="4" y="24">{seconds(maximum)}</text><text x="20" y="180">0s</text>
            {['avgMs', 'p95Ms'].map(metric => <g key={metric} className={`performance-series-${metric}`}>
                <polyline points={rows.map((row, index) => `${x(index)},${y(row[metric])}`).join(' ')} />
                {rows.map((row, index) => <circle key={`${row.date}-${index}`} cx={x(index)} cy={y(row[metric])} r="4" />)}
            </g>)}
            <text x="60" y="202">{rows[0].date}</text><text x="620" y="202" textAnchor="end">{rows[rows.length - 1].date}</text>
        </svg>
        <p className="performance-legend"><span className="performance-average">Average</span><span className="performance-p95">p95</span></p>
        <details><summary>Daily values</summary><div className="performance-table-scroll"><table>
            <thead><tr><th scope="col">Date</th><th scope="col">Samples</th><th scope="col">Average</th><th scope="col">p95</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.date}><td>{row.date}</td><td>{row.sampleCount}</td><td>{seconds(row.avgMs)}</td><td>{seconds(row.p95Ms)}</td></tr>)}</tbody>
        </table></div></details>
    </div>;
}

function LoadDetails({ sample }) {
    return <details className="performance-sample">
        <summary>{sample.recordedAt} · {sample.groupId} · {sample.sprintId || 'No sprint'} · {seconds(sample.durationMs)} · {sample.outcome}</summary>
        <p>{sample.surface} · Revision {sample.revision || 'Unknown'} · {sample.environment || 'Unknown environment'}</p>
        <p>{sample.surface === 'eng_board' ? 'First focused content' : 'First lane rendered'}: {seconds(sample.firstFocusedContentMs ?? sample.firstContentMs)}</p>
        <p>Requested dependency loading: {seconds(sample.dependencyDurationMs)}</p>
        {sample.surface === 'eng_board' && <>
            <p>Scope {sample.scopeType || 'Unknown'} · Index {seconds(sample.indexMs)} · Focused column complete {seconds(sample.focusedCompleteMs)}</p>
            <p>{count(sample.issueCount)} work items · {count(sample.epicCount)} Epics · {count(sample.payloadBytes)} bytes · {sample.cacheState || 'unknown'} cache · {sample.completeness || 'unknown'} completeness · peak child searches {count(sample.peakChildSearches)}</p>
            <p>Jira requests / pages / retries: {count(sample.jiraRequests)} / {count(sample.jiraPages)} / {count(sample.jiraRetries)}</p>
        </>}
        <div className="performance-table-scroll"><table>
            <thead><tr>{['Lane', 'Time', 'Issues', 'Epics', 'Stories', 'Bytes', 'Cache', 'Completeness', 'Jira requests / pages / retries'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{(sample.lanes || []).map((lane, index) => <tr key={index}>
                <th scope="row">{lane.project}</th><td>{seconds(lane.durationMs)}</td><td>{count(lane.issueCount)}</td><td>{count(lane.epicCount)}</td><td>{count(lane.storyCount)}</td><td>{count(lane.payloadBytes)}</td><td>{lane.cacheState || 'unknown'}</td><td>{lane.completeness || 'unknown'}</td><td>{count(lane.jiraRequests)} / {count(lane.jiraPages)} / {count(lane.jiraRetries)}</td>
            </tr>)}</tbody>
        </table></div>
        {(sample.lanes || []).map((lane, index) => <p key={index}>{lane.project} stages: {Object.entries(lane.stages || {}).map(([stage, duration]) => `${stage}: ${seconds(duration)}`).join(' · ') || 'Unknown'}</p>)}
    </details>;
}

export default function PerformanceSettings({ backendUrl }) {
    const [filters, setFilters] = React.useState({ groupId: '', sprintId: '', surface: '', scopeType: '',
        cacheState: '', revision: '', scopeCohortDigest: '' });
    const [data, setData] = React.useState(null);
    const [options, setOptions] = React.useState({ groups: [], sprints: [], surfaces: [], scopeTypes: [],
        cacheStates: [], revisions: [], scopeCohortDigests: [] });
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [refresh, setRefresh] = React.useState(0);
    React.useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        setData(null);
        fetchAdminPerformance(backendUrl, filters, { signal: controller.signal }).then(result => {
            if (controller.signal.aborted) return;
            setData(result);
            if (result.filters) setOptions(result.filters);
        }).catch(failure => {
            if (controller.signal.aborted || isAuthenticationRequiredError(failure)) return;
            setError('Performance history could not be loaded. Try refreshing.');
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [backendUrl, filters, refresh]);
    const summary = data?.summary;
    return <section className="performance-settings" aria-label="Load performance" aria-busy={loading}>
        <h3>Load performance</h3>
        <p className="performance-intro">Selected group loads · 30-day history · 2s target · 4s p95 SLO</p>
        <div className="stats-controls">
            {[
                ['groupId', 'Group', options.groups], ['sprintId', 'Sprint', options.sprints],
                ['surface', 'Surface', options.surfaces], ['scopeType', 'Scope', options.scopeTypes],
                ['cacheState', 'Cache', options.cacheStates],
                ['revision', 'Revision', options.revisions],
                ['scopeCohortDigest', 'Configuration cohort', options.scopeCohortDigests],
            ].map(([key, label, values]) => <div className="stats-control-group" key={key}>
                <label htmlFor={`performance-${key}`}>{label}</label><select id={`performance-${key}`} aria-label={`Performance ${label.toLowerCase()}`} value={filters[key]} onChange={event => setFilters(previous => ({ ...previous, [key]: event.target.value }))}>
                    <option value="">All</option>{(values || []).map(value => <option key={value} value={value}>{value}</option>)}
                </select>
            </div>)}
            <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
        </div>
        {loading && <p role="status">Loading performance history…</p>}
        {error && <p role="alert">{error}</p>}
        {data?.enabled === false && <p role="status">Collection is paused or database storage is unavailable.</p>}
        {data?.enabled && summary?.sampleCount === 0 && <p role="status">No loads recorded in this selection yet. Open ENG and refresh a group to collect a measurement.</p>}
        {data?.truncated && <p role="status">History reached the {data.queryLimit} observation limit. Narrow the filters before comparing trends.</p>}
        {summary?.sampleCount > 0 && <>
            <p className="performance-summary">Average <strong>{seconds(summary.avgMs)}</strong> · p50 {seconds(summary.p50Ms)} · p95 <strong>{seconds(summary.p95Ms)}</strong> · {summary.eligibleCount} complete successful samples / {summary.sampleCount} observations</p>
            {filters.surface === 'eng_board' && <p>First focused content p50 {seconds(summary.p50FirstContentMs)} · p95 {seconds(summary.p95FirstContentMs)}. Full-load duration includes requested dependency loading.</p>}
            <p>{summary.breachCount} loads above 4s · {summary.errorCount} errors · {summary.cancelledCount} cancelled · {summary.cappedCount} capped · {summary.unknownCount || 0} completeness unverified</p>
            {(data.contextual || summary.contextual) && <p role="status">Contextual timings — completeness unverified.</p>}
            {summary.mixedCohorts && <p role="status">Choose one surface, scope, cache, revision and configuration cohort before comparing latency percentiles.</p>}
            <details className="performance-methodology"><summary>About these measurements</summary>
                {summary.eligibleCount < 20 && <p>Fewer than 20 complete successful loads: percentiles are preliminary.</p>}
                <p>Timing includes data collection through rendering. Failed, cancelled and capped loads are excluded from latency summaries. Unverified loads do not establish that the full-load SLO passes.</p>
                <p>Compare the same group, sprint, cache state and revision. Expand a load to inspect issue counts and backend stages.</p>
            </details>
            {summary.p95Ms > 4000 && <p className="performance-breach" role="status">p95 exceeds the 4s SLO. Expand slow loads below to compare lane times, issue counts, cache state and backend stages.</p>}
            <PerformanceTrend trend={data.trend} />
            <h4>Recent load evidence</h4>
            {data.samplesTruncated && <p>Showing the 200 most recent observations. Narrow the filters to investigate older loads.</p>}
            {(data.samples || []).map(sample => <LoadDetails key={sample.loadId} sample={sample} />)}
            {!data.samples?.length && <p>No observations in this selection.</p>}
        </>}
    </section>;
}
