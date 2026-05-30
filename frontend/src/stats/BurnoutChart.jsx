import * as React from 'react';

function BurnoutChart({
    open,
    burnoutAssigneeFilter,
    setBurnoutAssigneeFilter,
    burnoutAssigneeOptions,
    burndownMetric,
    setBurndownMetric,
    burndownMetricIsStoryPoints,
    burnoutTotals,
    burnoutLoading,
    burnoutError,
    burnoutChartModel,
    burnoutChartRef,
    burnoutHoverPoint,
    setBurnoutHoverPoint,
    burnoutHoverTeamKey,
    setBurnoutHoverTeamKey,
    burnoutTaskFilter,
    setBurnoutTaskFilter,
    formatBurndownValue,
    resolveBurnoutPointer,
    buildBurnoutTaskFilter,
    onAnalyticsAction
}) {
    return (
        <div className={`stats-view ${open ? 'open' : ''}`}>
            <div className="stats-controls">
                <div className="stats-control-group">
                    <label>Assignee</label>
                    <select
                        className="scenario-input"
                        value={burnoutAssigneeFilter}
                        onChange={(event) => {
                            onAnalyticsAction?.('filter_changed', {
                                filter_type: 'assignee',
                                selection_count_bucket: event.target.value === 'all' ? '0' : '1_5'
                            });
                            setBurnoutAssigneeFilter(event.target.value);
                        }}
                    >
                        {burnoutAssigneeOptions.map((item) => (
                            <option key={item.value} value={item.value}>
                                {item.events > 0 && item.value !== 'all'
                                    ? `${item.label} (${item.events})`
                                    : item.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="stats-control-group">
                    <label>Metric</label>
                    <select
                        className="scenario-input"
                        value={burndownMetric}
                        onChange={(event) => {
                            onAnalyticsAction?.('stats_action', {
                                workflow_action: 'metric_change',
                                metric: event.target.value === 'storyPoints' ? 'story_points' : 'issue_count'
                            });
                            setBurndownMetric(event.target.value);
                        }}
                    >
                        <option value="storyPoints">Story Points</option>
                        <option value="issueCount">Issue Count</option>
                    </select>
                </div>
            </div>

            <div className="stats-summary burnout-summary">
                <div className="stats-card">
                    <h4>Start</h4>
                    <div className="stat-value">{formatBurndownValue(burnoutTotals.start)}</div>
                    <div className="stats-note">
                        {burndownMetricIsStoryPoints ? 'Story points at sprint start' : 'Issues at sprint start'}
                    </div>
                </div>
                <div className="stats-card">
                    <h4>Added</h4>
                    <div className="stat-value">{formatBurndownValue(burnoutTotals.added)}</div>
                    <div className="stats-note">
                        {burndownMetricIsStoryPoints ? 'Story points added after sprint start' : 'Issues added after sprint start'}
                    </div>
                </div>
                <div className="stats-card">
                    <h4>Closed</h4>
                    <div className="stat-value">{formatBurndownValue(burnoutTotals.closed)}</div>
                    <div className="stats-note">
                        {burnoutTotals.closureBuckets.done} done · {burnoutTotals.closureBuckets.killed} killed · {burnoutTotals.closureBuckets.incomplete} incomplete
                    </div>
                </div>
                <div className="stats-card">
                    <h4>Remaining</h4>
                    <div className="stat-value">{formatBurndownValue(burnoutTotals.remaining)}</div>
                    <div className="stats-note">
                        {burndownMetricIsStoryPoints ? 'Open story points at sprint end' : 'Open issues at sprint end'}
                    </div>
                </div>
                <div className="stats-card">
                    <h4>Timezone</h4>
                    <div className="stat-value">UTC+2</div>
                </div>
            </div>
            {burnoutTaskFilter && (
                <div className="stats-note">
                    Task list filter: {burnoutTaskFilter.teamName} open on {burnoutTaskFilter.dateKey} ({burnoutTaskFilter.issueKeys.length})
                    <button
                        type="button"
                        className="stats-toggle"
                        style={{ marginLeft: '0.6rem' }}
                        onClick={() => {
                            onAnalyticsAction?.('chart_action', {
                                workflow_action: 'filter_clear',
                                chart_id: 'burnout'
                            });
                            setBurnoutTaskFilter(null);
                        }}
                    >
                        Clear
                    </button>
                </div>
            )}

            {burnoutLoading && (
                <div className="stats-note">Loading burndown history…</div>
            )}
            {!burnoutLoading && burnoutError && (
                <div className="stats-note" style={{ color: '#cf1322' }}>{burnoutError}</div>
            )}
            {!burnoutLoading && !burnoutError && !burnoutChartModel && (
                <div className="stats-note">No burndown timeline data found for the selected sprint and filters.</div>
            )}
            {!burnoutLoading && !burnoutError && burnoutChartModel && (
                <>
                    <div className="burnout-chart-wrap">
                        <div
                            className="burnout-chart"
                            ref={burnoutChartRef}
                            onMouseLeave={() => {
                                setBurnoutHoverPoint(null);
                                setBurnoutHoverTeamKey(null);
                            }}
                            role="img"
                            aria-label="Daily burndown stacked area chart by team"
                        >
                            <svg
                                className="burnout-area-chart"
                                viewBox={`0 0 ${burnoutChartModel.width} ${burnoutChartModel.height}`}
                                preserveAspectRatio="none"
                            >
                                {burnoutChartModel.yTicks.map((tick) => (
                                    <line
                                        key={`grid-${tick.value}`}
                                        className="burnout-grid-line"
                                        x1={burnoutChartModel.padding.left}
                                        x2={burnoutChartModel.width - burnoutChartModel.padding.right}
                                        y1={tick.y}
                                        y2={tick.y}
                                    />
                                ))}
                                {burnoutChartModel.weeklyMarkers.map((marker) => (
                                    <line
                                        key={`week-${marker.key}`}
                                        className="burnout-weekly-line"
                                        x1={marker.x}
                                        x2={marker.x}
                                        y1={burnoutChartModel.padding.top}
                                        y2={burnoutChartModel.height - burnoutChartModel.padding.bottom}
                                    />
                                ))}
                                {burnoutChartModel.futureOverlay && (
                                    <rect
                                        className="burnout-future-overlay"
                                        x={burnoutChartModel.futureOverlay.x}
                                        y={burnoutChartModel.padding.top}
                                        width={burnoutChartModel.futureOverlay.width}
                                        height={burnoutChartModel.height - burnoutChartModel.padding.top - burnoutChartModel.padding.bottom}
                                    />
                                )}
                                {burnoutChartModel.areas.map((area) => (
                                    <g key={`team-area-${area.team.key}`}>
                                        <path
                                            className={`burnout-area-team ${
                                                burnoutHoverTeamKey && burnoutHoverTeamKey !== area.team.key ? 'dimmed' : 'active'
                                            }`}
                                            d={area.areaPath}
                                            onMouseEnter={() => setBurnoutHoverTeamKey(area.team.key)}
                                            onMouseMove={() => setBurnoutHoverTeamKey(area.team.key)}
                                            style={{
                                                fill: area.team.color,
                                                stroke: area.team.color
                                            }}
                                        />
                                        <path
                                            className={`burnout-team-line ${
                                                burnoutHoverTeamKey && burnoutHoverTeamKey !== area.team.key ? 'dimmed' : 'active'
                                            }`}
                                            d={area.linePastPath || area.linePath}
                                            onMouseEnter={() => setBurnoutHoverTeamKey(area.team.key)}
                                            onMouseMove={() => setBurnoutHoverTeamKey(area.team.key)}
                                            style={{
                                                stroke: area.team.color
                                            }}
                                        />
                                        {area.lineFuturePath && (
                                            <path
                                                className={`burnout-team-line burnout-team-line-future ${
                                                    burnoutHoverTeamKey && burnoutHoverTeamKey !== area.team.key ? 'dimmed' : 'active'
                                                }`}
                                                d={area.lineFuturePath}
                                                onMouseEnter={() => setBurnoutHoverTeamKey(area.team.key)}
                                                onMouseMove={() => setBurnoutHoverTeamKey(area.team.key)}
                                                style={{
                                                    stroke: area.team.color
                                                }}
                                            />
                                        )}
                                    </g>
                                ))}
                                {burnoutHoverPoint && (
                                    <rect
                                        className="burnout-hover-band active"
                                        x={Math.max(
                                            burnoutChartModel.padding.left,
                                            (burnoutHoverPoint.row?.x || burnoutChartModel.padding.left) - (burnoutChartModel.xStep / 2)
                                        )}
                                        y={burnoutChartModel.padding.top}
                                        width={Math.max(8, burnoutChartModel.xStep)}
                                        height={burnoutChartModel.height - burnoutChartModel.padding.top - burnoutChartModel.padding.bottom}
                                    />
                                )}
                                <rect
                                    className="burnout-hover-capture"
                                    x={burnoutChartModel.padding.left}
                                    y={burnoutChartModel.padding.top}
                                    width={burnoutChartModel.width - burnoutChartModel.padding.left - burnoutChartModel.padding.right}
                                    height={burnoutChartModel.height - burnoutChartModel.padding.top - burnoutChartModel.padding.bottom}
                                    onMouseMove={(event) => {
                                        const point = resolveBurnoutPointer(event);
                                        if (!point) return;
                                        setBurnoutHoverTeamKey(point.hoveredTeamKey);
                                        setBurnoutHoverPoint({
                                            key: point.row.date,
                                            date: point.row.date,
                                            row: point.row,
                                            x: point.row.x,
                                            bubbleX: point.bubbleX
                                        });
                                    }}
                                    onClick={(event) => {
                                        const point = resolveBurnoutPointer(event);
                                        if (!point) return;
                                        const nextFilter = buildBurnoutTaskFilter(point.row.date, point.hoveredTeamKey);
                                        if (!nextFilter) return;
                                        onAnalyticsAction?.('chart_action', {
                                            workflow_action: 'select_point',
                                            chart_id: 'burnout',
                                            point_bucket: point.hoveredTeamKey ? 'team' : 'all'
                                        });
                                        setBurnoutTaskFilter((prev) => {
                                            if (!prev) return nextFilter;
                                            if (prev.dateKey === nextFilter.dateKey && prev.teamKey === nextFilter.teamKey) {
                                                return null;
                                            }
                                            return nextFilter;
                                        });
                                    }}
                                />
                                {burnoutChartModel.todayX !== null && (
                                    <>
                                        <line
                                            className="burnout-today-line"
                                            x1={burnoutChartModel.todayX}
                                            x2={burnoutChartModel.todayX}
                                            y1={burnoutChartModel.padding.top}
                                            y2={burnoutChartModel.height - burnoutChartModel.padding.bottom}
                                        />
                                        <text
                                            className="burnout-today-label"
                                            x={burnoutChartModel.todayX + 4}
                                            y={burnoutChartModel.padding.top + 11}
                                        >
                                            Today
                                        </text>
                                    </>
                                )}
                                {burnoutHoverPoint && (
                                    <line
                                        className="burnout-hover-line"
                                        x1={burnoutHoverPoint.x}
                                        x2={burnoutHoverPoint.x}
                                        y1={burnoutChartModel.padding.top}
                                        y2={burnoutChartModel.height - burnoutChartModel.padding.bottom}
                                    />
                                )}
                                {burnoutChartModel.yTicks.map((tick) => (
                                    <text
                                        key={`label-${tick.value}`}
                                        className="burnout-y-axis-label"
                                        x={burnoutChartModel.padding.left - 8}
                                        y={tick.y + 3}
                                        textAnchor="end"
                                    >
                                        {formatBurndownValue(tick.value)}
                                    </text>
                                ))}
                            </svg>
                        </div>
                        {burnoutHoverPoint && (
                            <div
                                className="burnout-hover-bubble"
                                style={{
                                    left: `${burnoutHoverPoint.bubbleX || 180}px`
                                }}
                            >
                                <div className="burnout-hover-title">{burnoutHoverPoint.date}</div>
                                <div className="burnout-hover-row">Total: <strong>{formatBurndownValue(burnoutHoverPoint.row?.total || 0)}</strong></div>
                                <div className="burnout-hover-row">
                                    Added: <strong>{formatBurndownValue(
                                        burndownMetricIsStoryPoints
                                            ? (burnoutHoverPoint.row?.details?.added || []).reduce((sum, event) => sum + Number(event?.metricValue || 0), 0)
                                            : (burnoutHoverPoint.row?.details?.added || []).length
                                    )}</strong> ·
                                    Closed: <strong>{formatBurndownValue(
                                        burndownMetricIsStoryPoints
                                            ? (burnoutHoverPoint.row?.details?.closed || []).reduce((sum, event) => sum + Number(event?.metricValue || 0), 0)
                                            : (burnoutHoverPoint.row?.details?.closed || []).length
                                    )}</strong>
                                </div>
                                {(burnoutHoverPoint.row?.details?.closed || []).slice(0, 5).map((event, index) => (
                                    <div
                                        key={`${event.issueKey}-${index}`}
                                        className="burnout-hover-row muted"
                                        style={{ color: burnoutChartModel.teamColors?.[event.teamName] || '#6b7280', opacity: 1 }}
                                    >
                                        <strong style={{ color: burnoutChartModel.teamColors?.[event.teamName] || '#374151' }}>
                                            {event.issueKey || 'Story'}
                                        </strong> · {String(event.status || 'closed').toUpperCase()} · {event.teamName} · {event.assigneeName}
                                    </div>
                                ))}
                                {(burnoutHoverPoint.row?.details?.closed || []).length > 5 && (
                                    <div className="burnout-hover-row muted">
                                        +{(burnoutHoverPoint.row?.details?.closed || []).length - 5} more closed stories
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="burnout-axis">
                        {burnoutChartModel.rows.map((row, index) => {
                            const date = new Date(`${row.date}T00:00:00`);
                            if (Number.isNaN(date.getTime())) return null;
                            const shouldShow = index === 0 || index === burnoutChartModel.rows.length - 1 || index % 7 === 0 || row.date === burnoutChartModel.todayDateKey;
                            if (!shouldShow) return null;
                            return (
                                <span key={row.date} className={row.date === burnoutChartModel.todayDateKey ? 'today' : ''}>
                                    {date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                </span>
                            );
                        })}
                    </div>
                    <div className="burnout-legend">
                        {burnoutChartModel.teams.map((team) => (
                            <span
                                key={team.key}
                                className={burnoutHoverTeamKey && burnoutHoverTeamKey !== team.key ? 'dimmed' : 'active'}
                                onMouseEnter={() => setBurnoutHoverTeamKey(team.key)}
                                onMouseLeave={() => setBurnoutHoverTeamKey(null)}
                            >
                                <i className="burnout-color" style={{ background: team.color }} />
                                {team.name}
                            </span>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export default React.memo(BurnoutChart);
