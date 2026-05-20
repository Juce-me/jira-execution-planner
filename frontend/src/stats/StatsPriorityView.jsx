import * as React from 'react';

function StatsPriorityView({
    open,
    priorityAxis,
    priorityHoverIndex,
    setPriorityHoverIndex,
    priorityRadar,
    priorityRows,
    buildRadarPoints,
    buildPriorityStatLink,
    formatPercent,
    resolveTeamColor
}) {
    return (
        <div className={`stats-view ${open ? 'open' : ''}`}>
            {priorityRadar.series.length > 0 && (
                <>
                    <svg className="priority-radar" viewBox="0 0 360 360" role="img" aria-label="Priority distribution radar chart">
                        <g transform="translate(180 180)">
                            {[0.25, 0.5, 0.75, 1].map((ratio, index) => (
                                <polygon
                                    key={`grid-${index}`}
                                    points={buildRadarPoints({
                                        values: Object.fromEntries(priorityAxis.map(axis => [axis, ratio * priorityRadar.maxValue])),
                                        radius: 120,
                                        center: 0,
                                        maxValue: priorityRadar.maxValue,
                                        axes: priorityAxis
                                    })}
                                    fill="none"
                                    stroke="#d9d9d9"
                                    strokeWidth="1"
                                />
                            ))}
                            {priorityAxis.map((axis, index) => {
                                const angle = (Math.PI * 2 * index) / priorityAxis.length - Math.PI / 2;
                                const x = Math.cos(angle) * 120;
                                const y = Math.sin(angle) * 120;
                                return (
                                    <line
                                        key={`axis-${axis}`}
                                        x1="0"
                                        y1="0"
                                        x2={x}
                                        y2={y}
                                        stroke="#d9d9d9"
                                        strokeWidth="1"
                                    />
                                );
                            })}
                            {priorityRadar.series.map((series, idx) => {
                                const color = resolveTeamColor(series.id);
                                const isActive = priorityHoverIndex === null || priorityHoverIndex === idx;
                                return (
                                    <polygon
                                        key={series.id}
                                        points={buildRadarPoints({
                                            values: series.pointsByPriority,
                                            radius: 120,
                                            center: 0,
                                            maxValue: priorityRadar.maxValue,
                                            axes: priorityAxis
                                        })}
                                        fill={color}
                                        fillOpacity={isActive ? '0.18' : '0.04'}
                                        stroke={color}
                                        strokeWidth={isActive ? '2.5' : '1.2'}
                                        style={{ transition: 'all 0.2s ease', cursor: 'pointer' }}
                                        onMouseEnter={() => setPriorityHoverIndex(idx)}
                                        onMouseLeave={() => setPriorityHoverIndex(null)}
                                    />
                                );
                            })}
                            {[0.25, 0.5, 0.75, 1].map((ratio, index) => (
                                <text
                                    key={`value-${index}`}
                                    x="0"
                                    y={-(120 * ratio) - 6}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fontSize="8"
                                    fill="#8c8c8c"
                                    fontFamily="IBM Plex Mono, monospace"
                                >
                                    {(priorityRadar.maxValue * ratio).toFixed(1)}
                                </text>
                            ))}
                            {priorityAxis.map((axis, index) => {
                                const angle = (Math.PI * 2 * index) / priorityAxis.length - Math.PI / 2;
                                const x = Math.cos(angle) * 150;
                                const y = Math.sin(angle) * 150;
                                return (
                                    <text
                                        key={`label-${axis}`}
                                        x={x}
                                        y={y}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                        fontSize="8"
                                        fill="#555"
                                        fontFamily="IBM Plex Mono, monospace"
                                    >
                                        {axis}
                                    </text>
                                );
                            })}
                        </g>
                    </svg>
                    <div className="priority-legend">
                        {priorityRadar.series.map((series, idx) => {
                            const color = resolveTeamColor(series.id);
                            const isActive = priorityHoverIndex === null || priorityHoverIndex === idx;
                            return (
                                <span
                                    key={series.id}
                                    style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                                    onMouseEnter={() => setPriorityHoverIndex(idx)}
                                    onMouseLeave={() => setPriorityHoverIndex(null)}
                                >
                                    <i style={{ background: color, opacity: isActive ? 0.95 : 0.45 }} />
                                    {series.name}
                                </span>
                            );
                        })}
                    </div>
                    <div className="priority-axis-note">Axis values show story points.</div>
                </>
            )}
            <table className="stats-table">
                <thead>
                    <tr>
                        <th className="dimension">Priority</th>
                        <th className="metric">Story Points</th>
                        <th className="metric">Done</th>
                        <th className="metric">Incomplete</th>
                        <th className="metric">Rate</th>
                    </tr>
                </thead>
                <tbody>
                    {priorityRows.map(row => {
                        const pointsLink = buildPriorityStatLink(row.points, {
                            priorityName: row.name
                        });
                        const doneLink = buildPriorityStatLink(row.done, {
                            priorityName: row.name,
                            statuses: ['Done']
                        });
                        const incompleteLink = buildPriorityStatLink(row.incomplete, {
                            priorityName: row.name,
                            excludeStatuses: ['Done', 'Killed']
                        });

                        return (
                            <tr key={row.name}>
                                <td className="dimension">{row.name}</td>
                                <td className="metric">
                                    <div className="postponed-cell">
                                        <span>{row.points.toFixed(1)}</span>
                                        {pointsLink && (
                                            <a
                                                className="stats-link"
                                                href={pointsLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="View stories for this priority in Jira"
                                                aria-label="Open stories in Jira"
                                            >
                                                ↗
                                            </a>
                                        )}
                                    </div>
                                </td>
                                <td className="metric">
                                    <div className="postponed-cell">
                                        <span>{row.done}</span>
                                        {doneLink && (
                                            <a
                                                className="stats-link"
                                                href={doneLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="View done stories for this priority in Jira"
                                                aria-label="Open done stories in Jira"
                                            >
                                                ↗
                                            </a>
                                        )}
                                    </div>
                                </td>
                                <td className="metric">
                                    <div className="postponed-cell">
                                        <span>{row.incomplete}</span>
                                        {incompleteLink && (
                                            <a
                                                className="stats-link"
                                                href={incompleteLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="View incomplete stories for this priority in Jira"
                                                aria-label="Open incomplete stories in Jira"
                                            >
                                                ↗
                                            </a>
                                        )}
                                    </div>
                                </td>
                                <td className="metric">{formatPercent(row.rate)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default React.memo(StatsPriorityView);
