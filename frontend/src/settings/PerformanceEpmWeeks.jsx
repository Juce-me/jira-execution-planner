import * as React from 'react';
import { PerformanceWeeksView, PRELIMINARY_LOADS, SERIES } from './PerformanceCatchUpWeeks.jsx';
import { seconds, weekLabel } from './performanceFormat.js';

// Weekly view of EPM loads, in the Catch Up grammar: average, median and p95 per week for the Home project list and the
// rollup (the server derives them, see _epm_weekly in load_performance.py), plus the per-project rollup table.

const METRICS = [
    { key: 'projectsListed', countKey: 'listLoads', title: 'Projects listed' },
    { key: 'rollupLoaded', countKey: 'loads', title: 'Rollup loaded' },
];
const weekName = week => `${weekLabel(week.weekStart)}${week.partial ? '*' : ''}`;
const valueOf = (week, metric, series) => (Number.isFinite(week[metric.key]?.[series.key]) ? week[metric.key][series.key] : null);

function notes(projectName) {
    return {
        projectsListed: 'Time until the Home project list arrived. Counts a load even when its rollup failed or it was cancelled afterwards. A Sprint change reloads the rollup alone, so it adds no list time.',
        rollupLoaded: projectName
            ? `Rollup time of ${projectName}: the all-projects response reports each project's server time, a single-project load reports its own request. Successful loads only; downloading and painting are not included.`
            : 'Time until the rollup was fetched, applied and painted, from the start of the load. Successful loads only.',
    };
}

const about = projectName => [
    'Weeks are UTC calendar weeks starting Monday. * marks a partial week: the current week is still filling, and the oldest week can begin before the 30-day window.',
    projectName
        ? 'Both charts cover only the loads that included this project. Use the Scope filter to compare Active, Backlog and Archived like with like.'
        : 'Each week blends every revision, tab and Sprint in the current selection. Use the Scope and Project filters to compare like with like. Archived boards are metadata only and are not measured.',
    `Fewer than ${PRELIMINARY_LOADS} loads in a week is preliminary: its p95 is close to the slowest load.`,
    'Background refreshes and the lazy per-project Archived load are not measured.',
];

function PerformanceEpmTables({ weeks, projects }) {
    const cells = (week, metric) => <>
        <td className="num">{week[metric.countKey]}</td>
        {SERIES.map(series => <td className="num" key={series.key}>{seconds(valueOf(week, metric, series))}</td>)}
    </>;
    return <>
        <details className="performance-methodology" open><summary>Weekly table</summary>
            <div className="performance-table-scroll"><table>
                <thead><tr>
                    <th scope="col">Week</th>
                    <th scope="col" className="num">List loads</th><th scope="col" className="num">List avg</th><th scope="col" className="num">List median</th><th scope="col" className="num">List p95</th>
                    <th scope="col" className="num">Rollup loads</th><th scope="col" className="num">Rollup avg</th><th scope="col" className="num">Rollup median</th><th scope="col" className="num">Rollup p95</th>
                    <th scope="col" className="num">Errors</th><th scope="col" className="num">Cancelled</th>
                </tr></thead>
                <tbody>{weeks.map(week => <tr key={week.weekStart}>
                    <td>{weekName(week)}</td>
                    {METRICS.map(metric => <React.Fragment key={metric.key}>{cells(week, metric)}</React.Fragment>)}
                    <td className="num">{week.errors}</td><td className="num">{week.cancelled}</td>
                </tr>)}</tbody>
            </table></div>
        </details>
        {projects.length > 0 && <details className="performance-methodology" open><summary>Rollup time by project</summary>
            <div className="performance-table-scroll"><table>
                <thead><tr>
                    <th scope="col">Project</th><th scope="col" className="num">Loads</th>
                    <th scope="col" className="num">Avg</th><th scope="col" className="num">Median</th><th scope="col" className="num">p95</th>
                </tr></thead>
                <tbody>{projects.map(project => <tr key={project.projectId}>
                    <th scope="row">{project.name}</th><td className="num">{project.loads}</td>
                    <td className="num">{seconds(project.avgMs)}</td><td className="num">{seconds(project.medianMs)}</td><td className="num">{seconds(project.p95Ms)}</td>
                </tr>)}</tbody>
            </table></div>
        </details>}
    </>;
}

export default function PerformanceEpmWeeks({ weekly, projects = [], projectName = '' }) {
    const config = React.useMemo(() => ({
        label: 'EPM', metrics: METRICS, notes: notes(projectName), about: about(projectName),
        extras: week => `Errors ${week.errors} · cancelled ${week.cancelled}`,
        table: weeks => <PerformanceEpmTables weeks={weeks} projects={projects} />,
    }), [projectName, projects]);
    return <PerformanceWeeksView weeks={weekly?.weeks || []} config={config} />;
}
