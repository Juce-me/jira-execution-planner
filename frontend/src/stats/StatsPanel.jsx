import React, { useEffect, useRef, useState } from 'react';
import BurnoutChart from './BurnoutChart.jsx';
import CohortGrid from '../cohort/CohortGrid.jsx';
import LeadTimesEpicCharts from '../cohort/LeadTimesEpicCharts.jsx';
import LeadTimesWorkflowStatusCard from '../cohort/LeadTimesWorkflowStatusCard.jsx';
import SegmentedControl from '../ui/SegmentedControl.jsx';
import { compareQuarterLabels } from '../cohort/cohortUtils.js';
import { buildRadarPoints, computeRate, formatPercent, getRateClass, resolveProjectTrackColor } from './statsUtils.js';
import StatsDeliverySummary from './StatsDeliverySummary.jsx';
import StatsPriorityView from './StatsPriorityView.jsx';
import StatsTeamsView from './StatsTeamsView.jsx';
import ExcludedCapacityLineChart from './ExcludedCapacityLineChart.jsx';
import EffortTypeSplitChart from './EffortTypeSplitChart.jsx';
import ProjectTrackTotalsBar from './ProjectTrackTotalsBar.jsx';
import ProjectTrackSprintChart from './ProjectTrackSprintChart.jsx';
import ProjectTrackBreakdownChart from './ProjectTrackBreakdownChart.jsx';
import ProjectTrackPhaseChart from './ProjectTrackPhaseChart.jsx';
import StatsRangeControl from './StatsRangeControl.jsx';
import { analyticsToken } from '../analytics/dashboardAnalytics.js';

export function StatsPanel({ stats, links, analytics, onSelectBurnoutTask,
    showStats, jiraUrl, activeGroupMissingComponents, priorityAxis, resolveStatsTeamColor
}) {
    const {
        canRenderStatsPanel,
        statsView,
        setStatsView,
        statsGraphMode,
        setStatsGraphMode,
        statsTotals,
        statsTeamRows,
        statsBarColumns,
        priorityRadar,
        priorityRows,
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
        burnoutTaskFilter,
        formatBurndownValue,
        buildBurnoutTaskFilter,
        excludedCapacitySprintOptions,
        excludedCapacityStartSprintId,
        excludedCapacityEndSprintId,
        setExcludedCapacityStartSprintId,
        setExcludedCapacityEndSprintId,
        excludedCapacityEpicDropdownRef,
        excludedCapacityEpicDropdownOpen,
        setExcludedCapacityEpicDropdownOpen,
        excludedCapacityFilterLabel,
        selectAllExcludedCapacityEpics,
        clearExcludedCapacityEpicSelection,
        excludedCapacityEpicCatalog,
        excludedCapacityEffectiveFilters,
        toggleExcludedCapacityEpicKey,
        excludedCapacityChartMode,
        setExcludedCapacityChartMode,
        excludedCapacityMetric,
        setExcludedCapacityMetric,
        formatExcludedPoints,
        effortSplitTotals,
        excludedCapacityLoading,
        excludedCapacityData,
        excludedCapacityError,
        excludedCapacityWarnings,
        effortSplitSprintLabel,
        effortSplitRows,
        effortSplitVisibleBuckets,
        toggleEffortSplitBucket,
        excludedCapacityEpicOptions,
        excludedCapacityRows,
        excludedCapacityLineSeries,
        excludedCapacityIsolatedTeam,
        setExcludedCapacityIsolatedTeam,
        excludedCapacitySprintRange,
        excludedCapacityModeOverall,
        excludedCapacityModeSprintRows,
        excludedCapacityModeTeamLineSeries,
        projectTrackCapacitySide,
        setProjectTrackCapacitySide,
        projectTrackExcludeAdHoc,
        setProjectTrackExcludeAdHoc,
        projectTrackExcludeExcludedCapacity,
        setProjectTrackExcludeExcludedCapacity,
        projectTrackMode,
        setProjectTrackMode,
        projectTrackTotals,
        projectTrackSeries,
        projectTrackRangeLabel,
        projectTrackColumnSplit,
        projectTrackBreakdown,
        projectTrackPhaseLoading,
        projectTrackPhaseError,
        projectTrackPhaseData,
        projectTrackPhaseSummary,
        projectTrackPhaseEpics,
        cohortQuarterOptions,
        cohortStartQuarter,
        cohortEndQuarter,
        setCohortStartQuarter,
        setCohortEndQuarter,
        setCohortSelectedRow,
        cohortGroupBy,
        setCohortGroupBy,
        cohortProjectFilter,
        setCohortProjectFilter,
        cohortProjectOptions,
        cohortAssigneeFilter,
        setCohortAssigneeFilter,
        cohortAssigneeOptions,
        cohortExcludeAdHoc,
        setCohortExcludeAdHoc,
        cohortExcludeCapacity,
        setCohortExcludeCapacity,
        cohortStatusControls,
        cohortStatusToggles,
        setCohortStatusToggles,
        cohortSummary,
        cohortWorkflowStatusTotal,
        cohortAverageLeadDays,
        cohortMedianLeadDays,
        cohortLoading,
        cohortError,
        cohortWarnings,
        cohortSelectedRowLabel,
        cohortGridModel,
        cohortSelectedRow,
        cohortOpenBars,
        cohortCompletedBars,
        burnoutScopedTeamIds,
        burnoutData,
    } = stats;
    const { buildStatLink, buildPriorityStatLink } = links;
    const { trackStatsAction, trackStatsAnalyticsAction } = analytics;
    const setBurnoutTaskFilter = onSelectBurnoutTask;
    const [priorityHoverIndex, setPriorityHoverIndex] = useState(null);
    const [burnoutHoverPoint, setBurnoutHoverPoint] = useState(null);
    const [burnoutHoverTeamKey, setBurnoutHoverTeamKey] = useState(null);
    const burnoutChartRef = useRef(null);
    useEffect(() => {
        setBurnoutHoverPoint(null);
        setBurnoutHoverTeamKey(null);
    }, [burnoutData, burnoutAssigneeFilter, statsView]);
    const resolveBurnoutPointer = React.useCallback((event) => {
        if (!burnoutChartModel) return null;
        const chart = burnoutChartRef.current;
        const rect = chart?.getBoundingClientRect();
        if (!rect) return null;
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;
        const contentWidth = Math.max(chart.scrollWidth || rect.width, 1);
        const ratioX = burnoutChartModel.width / contentWidth;
        const localX = (viewportX + (chart.scrollLeft || 0)) * ratioX;
        const localY = viewportY * (burnoutChartModel.height / rect.height);
        const clampedX = Math.max(
            burnoutChartModel.padding.left,
            Math.min(burnoutChartModel.width - burnoutChartModel.padding.right, localX)
        );
        const relative = clampedX - burnoutChartModel.padding.left;
        const rawIndex = burnoutChartModel.rows.length <= 1
            ? 0
            : Math.round(relative / Math.max(1, burnoutChartModel.xStep));
        const index = Math.max(0, Math.min(burnoutChartModel.rows.length - 1, rawIndex));
        const row = burnoutChartModel.rows[index];
        if (!row) return null;
        let hoveredTeamKey = null;
        for (let i = burnoutChartModel.teams.length - 1; i >= 0; i -= 1) {
            const team = burnoutChartModel.teams[i];
            const stack = row.stacks?.[team.key];
            if (!stack) continue;
            if ((stack.value || 0) <= 0) continue;
            if (localY >= stack.yTop && localY <= stack.yBottom) {
                hoveredTeamKey = team.key;
                break;
            }
        }
        return {
            row,
            hoveredTeamKey,
            viewportX,
            bubbleX: Math.max(180, Math.min(rect.width - 180, viewportX))
        };
    }, [burnoutChartModel]);
    useEffect(() => {
        if (!burnoutChartModel || statsView !== 'burnout') return;
        const chart = burnoutChartRef.current;
        if (!chart) return;
        if ((chart.scrollWidth || 0) <= (chart.clientWidth || 0) + 2) {
            chart.scrollLeft = 0;
            return;
        }
        const todayX = Number(burnoutChartModel.todayX);
        if (!Number.isFinite(todayX)) {
            chart.scrollLeft = 0;
            return;
        }
        const target = Math.max(0, todayX - (chart.clientWidth * 0.6));
        chart.scrollLeft = target;
    }, [burnoutChartModel, statsView]);
    return (
        <div className={`stats-panel ${showStats ? 'open' : ''}`}>
            {showStats && !canRenderStatsPanel && (
                <div className="stats-note">Load stats for the selected sprint.</div>
            )}
            {canRenderStatsPanel && (
                <>
                    <SegmentedControl
                        className="eng-mode-control stats-view-toggle"
                        ariaLabel="Statistics view" containerProps={{ 'data-onboarding-target': 'statistics-overview', tabIndex: -1 }}
                        value={statsView}
                        onChange={(nextView) => {
                            trackStatsAction('stats_action', nextView, { workflow_action: 'view_change' });
                            setStatsView(nextView);
                        }}
                        options={[
                            { value: 'teams', label: 'Teams' },
                            { value: 'priority', label: 'Priority' },
                            { value: 'burnout', label: 'Burndown' },
                            { value: 'cohort', label: 'Lead Times' },
                            { value: 'excludedCapacity', label: 'Excluded Capacity' },
                            { value: 'monoCrossShare', label: 'Mono vs Cross' },
                            { value: 'projectTrack', label: 'Project Track' }
                        ]}
                    />

                    {statsView !== 'cohort' && statsView !== 'excludedCapacity' && statsView !== 'monoCrossShare' && statsView !== 'projectTrack' && (
                        <StatsDeliverySummary
                            statsGraphMode={statsGraphMode}
                            setStatsGraphMode={setStatsGraphMode}
                            statsTotals={statsTotals}
                            computeRate={computeRate}
                            formatPercent={formatPercent}
                        />
                    )}

                    <StatsTeamsView
                        open={statsView === 'teams'}
                        statsTeamRows={statsTeamRows}
                        statsBarColumns={statsBarColumns}
                        statsGraphMode={statsGraphMode}
                        buildStatLink={buildStatLink}
                        computeRate={computeRate}
                        formatPercent={formatPercent}
                        getRateClass={getRateClass}
                    />

                    <StatsPriorityView
                        open={statsView === 'priority'}
                        priorityAxis={priorityAxis}
                        priorityHoverIndex={priorityHoverIndex}
                        setPriorityHoverIndex={setPriorityHoverIndex}
                        priorityRadar={priorityRadar}
                        priorityRows={priorityRows}
                        buildRadarPoints={buildRadarPoints}
                        buildPriorityStatLink={buildPriorityStatLink}
                        formatPercent={formatPercent}
                        resolveTeamColor={resolveStatsTeamColor}
                    />

                    <BurnoutChart
                        open={statsView === 'burnout'}
                        burnoutAssigneeFilter={burnoutAssigneeFilter}
                        setBurnoutAssigneeFilter={setBurnoutAssigneeFilter}
                        burnoutAssigneeOptions={burnoutAssigneeOptions}
                        burndownMetric={burndownMetric}
                        setBurndownMetric={setBurndownMetric}
                        burndownMetricIsStoryPoints={burndownMetricIsStoryPoints}
                        burnoutTotals={burnoutTotals}
                        burnoutLoading={burnoutLoading}
                        burnoutError={burnoutError}
                        burnoutChartModel={burnoutChartModel}
                        burnoutChartRef={burnoutChartRef}
                        burnoutHoverPoint={burnoutHoverPoint}
                        setBurnoutHoverPoint={setBurnoutHoverPoint}
                        burnoutHoverTeamKey={burnoutHoverTeamKey}
                        setBurnoutHoverTeamKey={setBurnoutHoverTeamKey}
                        burnoutTaskFilter={burnoutTaskFilter}
                        setBurnoutTaskFilter={setBurnoutTaskFilter}
                        formatBurndownValue={formatBurndownValue}
                        resolveBurnoutPointer={resolveBurnoutPointer}
                        buildBurnoutTaskFilter={buildBurnoutTaskFilter}
                        onAnalyticsAction={trackStatsAnalyticsAction}
                    />
                    <div className={`stats-view ${statsView === 'excludedCapacity' ? 'open' : ''}`}>
                        <div className="stats-controls excluded-capacity-controls excluded-capacity-filter-controls">
                            <StatsRangeControl
                                idPrefix="excluded-capacity-sprint"
                                kindLabel="Sprint"
                                options={excludedCapacitySprintOptions.map((sprint) => ({ value: String(sprint.id), label: sprint.name || String(sprint.id) }))}
                                startValue={excludedCapacityStartSprintId}
                                endValue={excludedCapacityEndSprintId}
                                onStartChange={setExcludedCapacityStartSprintId}
                                onEndChange={setExcludedCapacityEndSprintId}
                                active={statsView === 'excludedCapacity'}
                            />
                            <div className="stats-control-group excluded-capacity-epic-filter" ref={excludedCapacityEpicDropdownRef}>
                                <label>Excluded Epics</label>
                                <div className="team-dropdown excluded-capacity-epic-dropdown">
                                    <button
                                        type="button"
                                        className={`team-dropdown-toggle ${excludedCapacityEpicDropdownOpen ? 'open' : ''}`}
                                        onClick={() => setExcludedCapacityEpicDropdownOpen(prev => !prev)}
                                        aria-haspopup="listbox"
                                        aria-expanded={excludedCapacityEpicDropdownOpen}
                                    >
                                        <span>{excludedCapacityFilterLabel}</span>
                                        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                            <path d="M6 9L1 4h10z" />
                                        </svg>
                                    </button>
                                    {excludedCapacityEpicDropdownOpen && (
                                        <div className="team-dropdown-panel excluded-capacity-epic-panel" role="listbox" aria-multiselectable="true">
                                            <div className="sprint-dropdown-list">
                                                <div
                                                    className="sprint-dropdown-option"
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={selectAllExcludedCapacityEpics}
                                                >
                                                    All configured
                                                </div>
                                                <div
                                                    className="sprint-dropdown-option"
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={clearExcludedCapacityEpicSelection}
                                                >
                                                    Clear
                                                </div>
                                            </div>
                                            {excludedCapacityEpicCatalog.length === 0 ? (
                                                <div className="sprint-dropdown-option">No excluded epics configured.</div>
                                            ) : (
                                                excludedCapacityEpicCatalog.map((entry) => {
                                                    const checked = excludedCapacityEffectiveFilters.includes(entry.key);
                                                    const primary = entry.summary || entry.key;
                                                    return (
                                                        <label
                                                            key={entry.key}
                                                            className="team-dropdown-option"
                                                            role="option"
                                                            aria-selected={checked}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => toggleExcludedCapacityEpicKey(entry.key)}
                                                            />
                                                            <span>
                                                                {primary}
                                                                <span className="component-result-meta"> · {entry.key}</span>
                                                            </span>
                                                        </label>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="excluded-capacity-actions">
                                <SegmentedControl
                                    ariaLabel="Series mode"
                                    value={excludedCapacityChartMode}
                                    onChange={(nextMode) => {
                                        trackStatsAnalyticsAction('chart_action', {
                                            workflow_action: 'mode_change',
                                            chart_id: 'excluded_capacity',
                                            series_type: analyticsToken(nextMode)
                                        });
                                        setExcludedCapacityChartMode(nextMode);
                                    }}
                                    options={[
                                        { value: 'teams', label: 'Teams' },
                                        { value: 'group', label: 'Group' }
                                    ]}
                                />
                                <SegmentedControl
                                    ariaLabel="Metric"
                                    value={excludedCapacityMetric}
                                    onChange={(nextMetric) => {
                                        trackStatsAnalyticsAction('stats_action', {
                                            workflow_action: 'metric_change',
                                            metric: nextMetric === 'storyPoints' ? 'story_points' : 'percent'
                                        });
                                        setExcludedCapacityMetric(nextMetric);
                                    }}
                                    options={[
                                        { value: 'percent', label: 'Percentage' },
                                        { value: 'storyPoints', label: 'Story Points' }
                                    ]}
                                />
                            </div>
                        </div>

                        <div className="stats-summary excluded-capacity-summary">
                            <div className="stats-card">
                                <h4>Excluded SP</h4>
                                <div className="stat-value">{formatExcludedPoints(effortSplitTotals.excludedCapacityPoints)}</div>
                                <div className="stats-note">Out of {formatExcludedPoints(effortSplitTotals.totalPoints)} scoped SP</div>
                            </div>
                            <div className="stats-card">
                                <h4>Excluded Share</h4>
                                <div className="stat-value">{formatPercent(effortSplitTotals.excludedCapacityPercent)}</div>
                                <div className="stats-note">Approximate, story-point based</div>
                            </div>
                            <div className="stats-card">
                                <h4>Ad Hoc Share</h4>
                                <div className="stat-value">{formatPercent(effortSplitTotals.adHocPercent)}</div>
                                <div className="stats-note">Included in Product capacity</div>
                            </div>
                            <div className="stats-card">
                                <h4>Product total</h4>
                                <div className="stat-value">{formatPercent(effortSplitTotals.productTotalPercent)}</div>
                                <div className="stats-note">Product including Ad Hoc</div>
                            </div>
                            <div className="stats-card">
                                <h4>Tech Share</h4>
                                <div className="stat-value">{formatPercent(effortSplitTotals.techPercent)}</div>
                                <div className="stats-note">Approximate, story-point based</div>
                            </div>
                        </div>

                        {excludedCapacityLoading && (
                            <div className="stats-note">
                                Loading excluded capacity analytics{excludedCapacityData?.meta?.totalSprintCount ? ` (${excludedCapacityData?.meta?.loadedSprintCount || 0}/${excludedCapacityData.meta.totalSprintCount} sprints)` : '...'}
                            </div>
                        )}
                        {excludedCapacityError && effortSplitTotals.totalPoints === 0 && (
                            <div className="stats-note cohort-error">{excludedCapacityError}</div>
                        )}
                        {!excludedCapacityError && excludedCapacityWarnings.length > 0 && (
                            <div className="cohort-warnings">
                                {excludedCapacityWarnings.map((warning, index) => (
                                    <div key={`${warning}-${index}`}>- {warning}</div>
                                ))}
                            </div>
                        )}
                        {!excludedCapacityLoading && !excludedCapacityError && effortSplitTotals.totalPoints === 0 && (
                            <div className="cohort-empty">No capacity-mix stories found in the selected sprint range.</div>
                        )}
                        {!excludedCapacityError && effortSplitTotals.totalPoints > 0 && (
                            <div className="excluded-capacity-panel">
                                <div className="cohort-section cohort-section-fullbleed">
                                    <div className="cohort-section-title">Effort Split</div>
                                    <div className="cohort-section-subtitle">
                                        Selected sprint-range story points by Excluded Capacity, Ad Hoc, Product, and Tech.
                                    </div>
                                    <div className="cohort-section-subtitle">
                                        Sprint range: {effortSplitSprintLabel}
                                    </div>
                                    <EffortTypeSplitChart
                                        rows={effortSplitRows}
                                        metric={excludedCapacityMetric}
                                        visibleBuckets={effortSplitVisibleBuckets}
                                        onToggleBucket={toggleEffortSplitBucket}
                                        onAnalyticsAction={trackStatsAnalyticsAction}
                                        formatExcludedPoints={formatExcludedPoints}
                                        formatPercent={formatPercent}
                                    />
                                </div>
                                <div className="cohort-section cohort-section-fullbleed">
                                    <div className="cohort-section-title">Excluded Capacity by Team and Sprint</div>
                                    {excludedCapacityEpicOptions.length === 0 ? (
                                        <div className="cohort-empty excluded-capacity-line-empty">
                                            No excluded capacity epics are configured for this team group. This chart tracks excluded capacity only; Ad Hoc is reported in the Effort Split above.
                                        </div>
                                    ) : excludedCapacityRows.length === 0 ? (
                                        <div className="cohort-empty excluded-capacity-line-empty">
                                            No excluded capacity stories found in the selected sprint range.
                                        </div>
                                    ) : (
                                        <ExcludedCapacityLineChart
                                            series={excludedCapacityLineSeries.series}
                                            sprints={excludedCapacityLineSeries.sprints}
                                            metric={excludedCapacityMetric}
                                            mode={excludedCapacityLineSeries.mode}
                                            isolatedSeriesId={excludedCapacityIsolatedTeam}
                                            onSelectSeries={setExcludedCapacityIsolatedTeam}
                                            onAnalyticsAction={trackStatsAnalyticsAction}
                                            resolveTeamColor={resolveStatsTeamColor}
                                            formatExcludedPoints={formatExcludedPoints}
                                            formatPercent={formatPercent}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={`stats-view ${statsView === 'monoCrossShare' ? 'open' : ''}`}>
                        <div className="stats-controls excluded-capacity-controls">
                            <StatsRangeControl
                                idPrefix="mono-cross-sprint"
                                kindLabel="Sprint"
                                options={excludedCapacitySprintOptions.map((sprint) => ({ value: String(sprint.id), label: sprint.name || String(sprint.id) }))}
                                startValue={excludedCapacityStartSprintId}
                                endValue={excludedCapacityEndSprintId}
                                onStartChange={setExcludedCapacityStartSprintId}
                                onEndChange={setExcludedCapacityEndSprintId}
                                active={statsView === 'monoCrossShare'}
                            />
                        </div>

                        <div className="stats-summary excluded-capacity-summary">
                            <div className="stats-card">
                                <h4>Range</h4>
                                <div className="stat-value">{excludedCapacitySprintRange.length}</div>
                                <div className="stats-note">Selected Jira sprints</div>
                            </div>
                            <div className="stats-card">
                                <h4>Cross Epic SP</h4>
                                <div className="stat-value">{formatExcludedPoints(excludedCapacityModeOverall.crossPoints)}</div>
                                <div className="stats-note">In multi-team epic/sprint buckets</div>
                            </div>
                            <div className="stats-card">
                                <h4>Total SP</h4>
                                <div className="stat-value">{formatExcludedPoints(excludedCapacityModeOverall.sharedPoints)}</div>
                                <div className="stats-note">Total scoped epic/sprint SP</div>
                            </div>
                            <div className="stats-card">
                                <h4>Cross Share</h4>
                                <div className="stat-value">{formatPercent(excludedCapacityModeOverall.crossPercent)}</div>
                                <div className="stats-note">Cross SP / total SP</div>
                            </div>
                        </div>

                        {excludedCapacityLoading && (
                            <div className="stats-note">
                                Loading mono vs cross share{excludedCapacityData?.meta?.totalSprintCount ? ` (${excludedCapacityData?.meta?.loadedSprintCount || 0}/${excludedCapacityData.meta.totalSprintCount} sprints)` : '...'}
                            </div>
                        )}
                        {excludedCapacityError && excludedCapacityModeOverall.totalPoints === 0 && (
                            <div className="stats-note cohort-error">{excludedCapacityError}</div>
                        )}
                        {!excludedCapacityLoading && !excludedCapacityError && excludedCapacityModeOverall.totalPoints === 0 && (
                            <div className="cohort-empty">No epic share available for the current selection.</div>
                        )}
                        {!excludedCapacityError && excludedCapacityModeOverall.totalPoints > 0 && (
                            <div className="excluded-capacity-panel">
                                <div className="cohort-section">
                                    <div className="cohort-section-title">Cross-Team Epic Footprint</div>
                                    <div className="cohort-section-subtitle">
                                        Cross = an epic has stories from more than one team in the same sprint.
                                    </div>
                                    <div className="epic-mode-bars" role="img" aria-label="Cross-team epic share by sprint">
                                        {[
                                            { ...excludedCapacityModeOverall, sprintName: 'Total', sprintId: 'overall' },
                                            ...excludedCapacityModeSprintRows
                                        ].map(row => (
                                            <div className="epic-mode-row" key={row.sprintId || row.sprintName}>
                                                <div className="epic-mode-label">{row.sprintName}</div>
                                                <div className="epic-mode-track">
                                                    <div
                                                        className="epic-mode-fill cross"
                                                        style={{ width: `${Math.max(0, Math.min(100, row.crossPercent * 100))}%` }}
                                                        title={`${row.sprintName}: ${formatExcludedPoints(row.crossPoints)} cross SP of ${formatExcludedPoints(row.sharedPoints)} total SP`}
                                                    />
                                                </div>
                                                <div className="epic-mode-values">
                                                    <span>{formatExcludedPoints(row.crossPoints)} cross</span>
                                                    <span>{formatExcludedPoints(row.sharedPoints)} total</span>
                                                    <span>{formatPercent(row.crossPercent)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="cohort-section">
                                    <div className="cohort-section-title">Team Cross Share</div>
                                    <div className="cohort-section-subtitle">
                                        Percentage = team cross SP / total team story points in each sprint.
                                    </div>
                                    <ExcludedCapacityLineChart
                                        series={excludedCapacityModeTeamLineSeries.series}
                                        sprints={excludedCapacityModeTeamLineSeries.sprints}
                                        metric="percent"
                                        mode="teams"
                                        isolatedSeriesId={excludedCapacityIsolatedTeam}
                                        onSelectSeries={setExcludedCapacityIsolatedTeam}
                                        onAnalyticsAction={trackStatsAnalyticsAction}
                                        resolveTeamColor={resolveStatsTeamColor}
                                        formatExcludedPoints={formatExcludedPoints}
                                        formatPercent={formatPercent}
                                        ariaLabel="Team cross share per sprint"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={`stats-view ${statsView === 'projectTrack' ? 'open' : ''}`}>
                        <div className="stats-controls project-track-controls">
                            <StatsRangeControl
                                idPrefix="project-track-sprint"
                                kindLabel="Sprint"
                                options={excludedCapacitySprintOptions.map((sprint) => ({ value: String(sprint.id), label: sprint.name || String(sprint.id) }))}
                                startValue={excludedCapacityStartSprintId}
                                endValue={excludedCapacityEndSprintId}
                                onStartChange={setExcludedCapacityStartSprintId}
                                onEndChange={setExcludedCapacityEndSprintId}
                                active={statsView === 'projectTrack'}
                            />
                            <div className="stats-control-group">
                                <label>Capacity side</label>
                                <SegmentedControl
                                    className="eng-mode-control"
                                    ariaLabel="Capacity side"
                                    value={projectTrackCapacitySide}
                                    onChange={(nextSide) => {
                                        trackStatsAnalyticsAction('chart_action', {
                                            workflow_action: 'capacity_side_change',
                                            chart_id: 'project_track',
                                            capacity_side: analyticsToken(nextSide)
                                        });
                                        setProjectTrackCapacitySide(nextSide);
                                    }}
                                    options={[
                                        { value: 'product', label: 'Product' },
                                        { value: 'tech', label: 'Tech' },
                                        { value: 'both', label: 'Tech + Product' }
                                    ]}
                                />
                            </div>
                            <div className="stats-control-group project-track-exclusions">
                                <label>Exclusions</label>
                                <label className="project-track-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={projectTrackExcludeAdHoc}
                                        onChange={(event) => {
                                            const checked = event.target.checked;
                                            trackStatsAnalyticsAction('filter_changed', {
                                                filter_type: 'exclude_ad_hoc',
                                                chart_id: 'project_track',
                                                value_state: checked ? 'on' : 'off'
                                            });
                                            setProjectTrackExcludeAdHoc(checked);
                                        }}
                                    />
                                    <span>Exclude Ad Hoc</span>
                                </label>
                                <label className="project-track-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={projectTrackExcludeExcludedCapacity}
                                        onChange={(event) => {
                                            const checked = event.target.checked;
                                            trackStatsAnalyticsAction('filter_changed', {
                                                filter_type: 'exclude_excluded_capacity',
                                                chart_id: 'project_track',
                                                value_state: checked ? 'on' : 'off'
                                            });
                                            setProjectTrackExcludeExcludedCapacity(checked);
                                        }}
                                    />
                                    <span>Exclude Excluded Capacity</span>
                                </label>
                            </div>
                            <div className="stats-control-group">
                                <label>Mode</label>
                                <SegmentedControl
                                    className="eng-mode-control"
                                    ariaLabel="Mode"
                                    value={projectTrackMode}
                                    onChange={(nextMode) => {
                                        trackStatsAnalyticsAction('stats_action', {
                                            workflow_action: 'mode_change',
                                            chart_id: 'project_track',
                                            mode: analyticsToken(nextMode)
                                        });
                                        setProjectTrackMode(nextMode);
                                    }}
                                    options={[
                                        { value: 'epic', label: 'Epic' },
                                        { value: 'team', label: 'Team' }
                                    ]}
                                />
                            </div>
                        </div>

                        <div className="project-track-mode-title">
                            {projectTrackMode === 'team' ? 'TEAM MODE' : 'EPIC MODE'}
                        </div>

                        <div className="stats-card project-track-card">
                            <ProjectTrackTotalsBar
                                byTrack={projectTrackTotals.byTrack}
                                tracks={projectTrackSeries.tracks}
                                resolveColor={resolveProjectTrackColor}
                                rangeLabel={projectTrackRangeLabel}
                                columnSplit={projectTrackColumnSplit}
                            />
                        </div>

                        {projectTrackSeries.sprints.length > 1 && (
                            <div className="stats-card project-track-card">
                                <h4>Story points per sprint</h4>
                                <ProjectTrackSprintChart
                                    series={projectTrackSeries}
                                    resolveColor={resolveProjectTrackColor}
                                    caption={projectTrackMode === 'epic'
                                        ? 'Each epic is attributed to its dominant sprint; all of its story points land in that sprint.'
                                        : ''}
                                />
                            </div>
                        )}

                        <div className="stats-card project-track-card">
                            <h4>{projectTrackMode === 'team' ? 'By team' : 'By assignee'}</h4>
                            <ProjectTrackBreakdownChart
                                data={projectTrackBreakdown}
                                resolveColor={resolveProjectTrackColor}
                                jiraUrl={jiraUrl}
                                columnSplit={projectTrackColumnSplit}
                            />
                        </div>

                        {projectTrackMode === 'epic' && (
                            <div className="stats-card project-track-card project-track-phase-section">
                                <h4>Time in Project Track phase</h4>
                                {projectTrackPhaseLoading && (
                                    <div className="project-track-phase-loading">Loading phase data…</div>
                                )}
                                {!projectTrackPhaseLoading && projectTrackPhaseError && (
                                    <div className="project-track-phase-error">{projectTrackPhaseError}</div>
                                )}
                                {!projectTrackPhaseLoading && !projectTrackPhaseError && (
                                    <>
                                        {projectTrackPhaseData?.meta?.truncated && (
                                            <div className="project-track-phase-truncated">
                                                Showing first {projectTrackPhaseData.meta.processedEpicCount} epics (truncated).
                                            </div>
                                        )}
                                        <div className="project-track-phase-summary">
                                            {projectTrackPhaseSummary.avgDaysToFirstTrack > 0 && (
                                                <span>Avg days to first track: <strong>{projectTrackPhaseSummary.avgDaysToFirstTrack}d</strong></span>
                                            )}
                                            {projectTrackPhaseSummary.avgDaysToCommitted != null && (
                                                <span>Avg days to Committed: <strong>{projectTrackPhaseSummary.avgDaysToCommitted}d</strong></span>
                                            )}
                                        </div>
                                        <ProjectTrackPhaseChart
                                            rows={projectTrackPhaseEpics}
                                            resolveColor={resolveProjectTrackColor}
                                            jiraUrl={jiraUrl}
                                        />
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className={`stats-view ${statsView === 'cohort' ? 'open' : ''}`}>
                        <div className="stats-controls cohort-controls">
                            <StatsRangeControl
                                idPrefix="lead-times-quarter"
                                kindLabel="Quarter"
                                options={cohortQuarterOptions.map((quarter) => ({ value: quarter, label: quarter }))}
                                startValue={cohortStartQuarter}
                                endValue={cohortEndQuarter}
                                onStartChange={(nextStart) => {
                                    setCohortStartQuarter(nextStart);
                                    if (compareQuarterLabels(nextStart, cohortEndQuarter) > 0) setCohortEndQuarter(nextStart);
                                    setCohortSelectedRow(null);
                                }}
                                onEndChange={(nextEnd) => {
                                    setCohortEndQuarter(nextEnd);
                                    if (compareQuarterLabels(cohortStartQuarter, nextEnd) > 0) setCohortStartQuarter(nextEnd);
                                    setCohortSelectedRow(null);
                                }}
                                active={statsView === 'cohort'}
                            />
                            <div className="stats-control-group">
                                <div className="controls-label">Group By</div>
                                <SegmentedControl
                                    className="eng-mode-control"
                                    ariaLabel="Group by"
                                    value={cohortGroupBy}
                                    onChange={(next) => { setCohortGroupBy(next === 'month' ? 'month' : 'quarter'); setCohortSelectedRow(null); }}
                                    options={[{ value: 'quarter', label: 'Quarter' }, { value: 'month', label: 'Month' }]}
                                />
                            </div>
                            <div className="stats-control-group">
                                <div className="controls-label">Project</div>
                                <select
                                    className="scenario-input"
                                    aria-label="Project"
                                    value={cohortProjectFilter}
                                    onChange={(event) => {
                                        setCohortProjectFilter(event.target.value);
                                        setCohortSelectedRow(null);
                                    }}
                                >
                                    {cohortProjectOptions.map((item) => (
                                        <option key={item.value} value={item.value}>{item.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="stats-control-group">
                                <div className="controls-label">Assignee</div>
                                <select
                                    className="scenario-input"
                                    aria-label="Assignee"
                                    value={cohortAssigneeFilter}
                                    onChange={(event) => {
                                        setCohortAssigneeFilter(event.target.value);
                                        setCohortSelectedRow(null);
                                    }}
                                >
                                    {cohortAssigneeOptions.map((item) => (
                                        <option key={item.value} value={item.value}>
                                            {item.label}{item.value !== 'all' ? ` (${item.count})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="stats-control-group project-track-exclusions" data-stats-capacity-filters>
                                <div className="controls-label">Exclude</div>
                                <div className="cohort-exclusion-options">
                                    <label className="project-track-checkbox">
                                        <input
                                            type="checkbox"
                                            aria-label="Exclude Ad Hoc"
                                            checked={cohortExcludeAdHoc}
                                            onChange={(e) => { setCohortExcludeAdHoc(e.target.checked); setCohortSelectedRow(null); }}
                                        />
                                        <span>Ad Hoc</span>
                                    </label>
                                    <label className="project-track-checkbox">
                                        <input
                                            type="checkbox"
                                            aria-label="Exclude Excluded Capacity"
                                            checked={cohortExcludeCapacity}
                                            onChange={(e) => { setCohortExcludeCapacity(e.target.checked); setCohortSelectedRow(null); }}
                                        />
                                        <span>Excluded Capacity</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="stats-actions cohort-status-actions">
                            {cohortStatusControls.map((item) => (
                                <button
                                    key={item.key}
                                    className={`stats-toggle ${cohortStatusToggles[item.key] ? 'active' : ''}`}
                                    onClick={() => {
                                        setCohortStatusToggles((prev) => ({
                                            ...prev,
                                            [item.key]: !prev[item.key]
                                        }));
                                        setCohortSelectedRow(null);
                                    }}
                                    type="button"
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>

                        <div className="stats-summary cohort-summary">
                            <div className="stats-card">
                                <h4>Epics Overview</h4>
                                <div className="stat-value">{cohortSummary.total}</div>
                                <div className="stats-note">
                                    {cohortSummary.done} done · {cohortSummary.killed} killed · {cohortSummary.incomplete} incomplete
                                </div>
                            </div>
                            <LeadTimesWorkflowStatusCard
                                jiraUrl={jiraUrl}
                                cohortStartQuarter={cohortStartQuarter}
                                cohortEndQuarter={cohortEndQuarter}
                                cohortSummary={cohortSummary}
                                cohortWorkflowStatusTotal={cohortWorkflowStatusTotal}
                            />
                            <div className="stats-card">
                                <h4>Avg Lead Time</h4>
                                <div className="stat-value">
                                    {cohortAverageLeadDays === null ? '—' : `${cohortAverageLeadDays.toFixed(1)}d`}
                                </div>
                                <div className="stats-note">Terminal epics with lead time</div>
                            </div>
                            <div className="stats-card">
                                <h4>Median Lead Time</h4>
                                <div className="stat-value">
                                    {cohortMedianLeadDays === null ? '—' : `${cohortMedianLeadDays.toFixed(1)}d`}
                                </div>
                                <div className="stats-note">Middle terminal lead time</div>
                            </div>
                        </div>

                        {cohortLoading && <div className="stats-note">Loading lead time cohorts…</div>}
                        {!cohortLoading && cohortError && <div className="stats-note cohort-error">{cohortError}</div>}
                        {!cohortLoading && !cohortError && cohortWarnings.length > 0 && (
                            <div className="cohort-warnings">
                                {cohortWarnings.map((warning, index) => (
                                    <div key={`${warning}-${index}`}>• {warning}</div>
                                ))}
                            </div>
                        )}

                        {!cohortLoading && !cohortError && (
                            <div className="cohort-panel">
                                <div className="cohort-section cohort-section-fullbleed">
                                    <div className="cohort-section-title">
                                        Cohort Heatmap
                                        {cohortSelectedRowLabel && (
                                            <span className="cohort-selected-chip">
                                                Row: {cohortSelectedRowLabel}
                                                <button
                                                    type="button"
                                                    className="cohort-clear-row"
                                                    onClick={() => setCohortSelectedRow(null)}
                                                >
                                                    Clear
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                    <CohortGrid
                                        model={cohortGridModel}
                                        selectedRowKey={cohortSelectedRow}
                                        onSelectRow={(rowKey) => {
                                            setCohortSelectedRow((prev) => (prev === rowKey ? null : rowKey));
                                        }}
                                    />
                                </div>
                                <LeadTimesEpicCharts
                                    cohortOpenBars={cohortOpenBars}
                                    cohortCompletedBars={cohortCompletedBars}
                                    cohortSelectedRowLabel={cohortSelectedRowLabel}
                                    jiraUrl={jiraUrl}
                                    cohortStartQuarter={cohortStartQuarter}
                                    cohortEndQuarter={cohortEndQuarter}
                                    cohortGroupBy={cohortGroupBy}
                                    cohortSelectedRow={cohortSelectedRow}
                                    cohortProjectFilter={cohortProjectFilter}
                                    activeGroupMissingComponents={activeGroupMissingComponents}
                                    burnoutScopedTeamIds={burnoutScopedTeamIds}
                                    cohortAssigneeFilter={cohortAssigneeFilter}
                                />
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
