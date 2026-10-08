import React, { useEffect } from 'react';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { aggregateCohortSummary, buildCohortGridModel, buildCompletedEpicsBars, buildOpenEpicsBars, buildQuarterOptions, deriveAssigneeOptions, deriveProjectOptions, filterCohortIssues, getCurrentQuarterLabel, normalizeCohortStatus } from '../cohort/cohortUtils.js';
import { buildDefaultExcludedCapacityRange, buildEpicTeamCrossShareLineSeries, buildEpicTeamModeOverall, buildEpicTeamModeSprintRows, buildEffortTypeSplitRows, buildExcludedCapacityLineSeries, buildExcludedCapacityTimeSeries, buildExcludedEpicCatalog, compareSprintsChronologically, getSprintRange, loadExcludedCapacityStatsSourceChunks, mergeExcludedCapacityStatsSourceChunks, summarizeEffortTypeSplitTotals } from './excludedCapacityStats.js';
import { buildBurnoutChartModel } from './burnoutChartUtils.js';
import { buildLocalStatsFromTasks, computePriorityWeighted, computeRate, getPriorityLabel } from './statsUtils.js';
import { buildProjectTrackSprintSeries, summarizeProjectTrackTotals, buildProjectTrackBreakdownRows, buildProjectTrackColumnSplit, inScopeEpicKeys as projectTrackInScopeEpicKeys } from './projectTrackStats.js';
import { summarizeTrackPhaseDurations } from './projectTrackPhaseStats.js';
import { fetchExcludedCapacityStatsSource as requestExcludedCapacityStatsSource } from '../api/engApi.js';
import { fetchBurnoutStats as requestBurnoutStats, fetchEpicCohortStats as requestEpicCohortStats, fetchProjectTrackPhaseDurations as requestProjectTrackPhaseDurations } from '../api/statsApi.js';

export function useStatsDerivedA({
    scope, BACKEND_URL, activeGroupMissingComponents, activeGroupTeamIds,
    activeGroupTeamSet, burnoutAssigneeFilter, burnoutCacheRef, burnoutData,
    cohortEndQuarter, cohortStartQuarter, getTeamInfo, groupPreferences,
    isCompletedSprintSelected, issueEditStateRef, issuePeopleStatsRevision, normalizeEpicKey,
    normalizeStatus, perfCountersRef, perfEnabled, setBurnoutAssigneeFilter,
    setBurnoutData, setBurnoutError, setBurnoutLoading, showStats,
    statsView, tasksFetched
}) {
    const {
        adHocEpicSet, adHocEpicSignature, capacityTasks, excludedEpicSet,
        isAllTeamsSelected, selectedSprintInfo, selectedTeamSet, techProjectKeys
    } = scope;
    const statsTaskList = React.useMemo(() => {
        if (!capacityTasks.length) return [];
        return capacityTasks.filter(task => {
            const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
            return !excludedEpicSet.has(epicKey);
        });
    }, [capacityTasks, excludedEpicSet]);
    const localStatsData = React.useMemo(() => {
        if (!showStats) return null;
        if (!statsTaskList.length) return null;
        if (perfEnabled) {
            perfCountersRef.current.statsBuild = (perfCountersRef.current.statsBuild || 0) + 1;
            performance.mark('localStatsBuild:start');
        }
        const result = buildLocalStatsFromTasks(statsTaskList, {
            excludedSet: new Set(),
            normalizeStatus,
            getTeamInfo,
            techProjectKeys,
            adHocEpicSet,
            sprintName: selectedSprintInfo?.name || ''
        });
        if (perfEnabled) {
            performance.mark('localStatsBuild:end');
            performance.measure('localStatsBuild', 'localStatsBuild:start', 'localStatsBuild:end');
            performance.clearMarks('localStatsBuild:start');
            performance.clearMarks('localStatsBuild:end');
            performance.clearMeasures('localStatsBuild');
        }
        return result;
    }, [statsTaskList, selectedSprintInfo?.name, showStats, perfEnabled, techProjectKeys, adHocEpicSet, adHocEpicSignature]);

    const effectiveStatsData = localStatsData;
    const burnoutTaskTeamByIssueKey = React.useMemo(() => {
        const byIssue = new Map();
        (statsTaskList || []).forEach((task) => {
            const issueKey = String(task?.key || '').trim().toUpperCase();
            if (!issueKey) return;
            const teamInfo = getTeamInfo(task);
            const teamId = teamInfo?.id && teamInfo.id !== 'unknown' ? String(teamInfo.id) : null;
            const teamName = String(teamInfo?.name || '').trim();
            if (!teamId && !teamName) return;
            byIssue.set(issueKey, {
                id: teamId,
                name: teamName || 'Unknown Team'
            });
        });
        return byIssue;
    }, [statsTaskList, getTeamInfo]);
    const burnoutTaskStatusByIssueKey = React.useMemo(() => {
        const byIssue = new Map();
        (statsTaskList || []).forEach((task) => {
            const issueKey = String(task?.key || '').trim().toUpperCase();
            if (!issueKey) return;
            byIssue.set(issueKey, normalizeStatus(task?.fields?.status?.name || ''));
        });
        return byIssue;
    }, [statsTaskList]);
    const burnoutIssueWeightByKey = React.useMemo(() => {
        const byIssue = new Map();
        (statsTaskList || []).forEach((task) => {
            const issueKey = String(task?.key || '').trim().toUpperCase();
            if (!issueKey) return;
            const raw = parseFloat(task?.fields?.customfield_10004 || 0);
            const sp = Number.isFinite(raw) ? Math.max(0, raw) : 0;
            byIssue.set(issueKey, sp);
        });
        return byIssue;
    }, [statsTaskList]);
    const burnoutIssueKeys = React.useMemo(() => {
        const keys = [];
        const seen = new Set();
        (statsTaskList || []).forEach((task) => {
            if (!task?.key) return;
            const teamInfo = getTeamInfo(task);
            if (isAllTeamsSelected) {
                if (activeGroupTeamIds.length && !activeGroupTeamSet.has(teamInfo.id)) {
                    return;
                }
            } else if (!selectedTeamSet.has(teamInfo.id)) {
                return;
            }
            const key = String(task.key || '').trim().toUpperCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            keys.push(key);
        });
        return keys;
    }, [statsTaskList, isAllTeamsSelected, selectedTeamSet, activeGroupTeamIds, activeGroupTeamSet, getTeamInfo]);
    const burnoutScopedTeamIds = React.useMemo(() => {
        if (isAllTeamsSelected) {
            return Array.from(new Set((activeGroupTeamIds || []).map((id) => String(id || '').trim()).filter(Boolean))).sort();
        }
        return Array.from(selectedTeamSet).filter(Boolean).sort();
    }, [isAllTeamsSelected, selectedTeamSet, activeGroupTeamIds]);
    const burnoutScopedTeamSignature = React.useMemo(
        () => burnoutScopedTeamIds.join(','),
        [burnoutScopedTeamIds]
    );
    const cohortScopedComponentsSignature = React.useMemo(
        () => activeGroupMissingComponents.slice().sort((a, b) => a.localeCompare(b)).join(','),
        [activeGroupMissingComponents]
    );
    const cohortScopedTeamSignature = React.useMemo(() => {
        const teamPart = burnoutScopedTeamSignature || 'group-empty';
        const componentPart = cohortScopedComponentsSignature || 'no-components';
        return `${teamPart}::${componentPart}`;
    }, [burnoutScopedTeamSignature, cohortScopedComponentsSignature]);
    const burnoutIssueKeysSignature = React.useMemo(
        () => burnoutIssueKeys.join(','),
        [burnoutIssueKeys]
    );
    const burnoutClosureScopeKey = isCompletedSprintSelected ? 'post' : 'inSprint';
    const burnoutQueryKey = React.useMemo(() => {
        const sprintLabel = selectedSprintInfo?.name || '';
        if (!sprintLabel) return '';
        return `${sprintLabel}::${burnoutClosureScopeKey}::${burnoutScopedTeamSignature || 'all'}::${burnoutIssueKeysSignature}`;
    }, [selectedSprintInfo?.name, burnoutClosureScopeKey, burnoutScopedTeamSignature, burnoutIssueKeysSignature]);
    const cohortQueryKey = React.useMemo(() => {
        const startQuarter = String(cohortStartQuarter || '').trim();
        const endQuarter = String(cohortEndQuarter || '').trim();
        if (!startQuarter || !endQuarter) return '';
        return `${startQuarter}::${endQuarter}::${cohortScopedTeamSignature}::${adHocEpicSignature || 'no-adhoc'}`;
    }, [cohortStartQuarter, cohortEndQuarter, cohortScopedTeamSignature, adHocEpicSignature]);

    useEffect(() => {
        if (!showStats || statsView !== 'burnout') return;
        if (groupPreferences.onboardingRequired) { setBurnoutData(null); setBurnoutError(''); setBurnoutLoading(false); return; }
        const sprintLabel = selectedSprintInfo?.name || '';
        if (!sprintLabel) {
            setBurnoutData(null);
            setBurnoutError('');
            setBurnoutLoading(false);
            return;
        }
        if (!tasksFetched) {
            setBurnoutLoading(true);
            setBurnoutError('');
            return;
        }
        if (!burnoutIssueKeys.length) {
            setBurnoutData(null);
            setBurnoutError('No scoped tasks available for burndown in the current filters.');
            setBurnoutLoading(false);
            return;
        }
        const cached = burnoutCacheRef.current[burnoutQueryKey];
        if (cached) {
            setBurnoutData(cached);
            setBurnoutError('');
            setBurnoutLoading(false);
            return;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
            try {
                controller.abort();
            } catch (err) {
                // ignore abort errors
            }
        }, 30000);
        let cancelled = false;
        const fetchBurnout = async () => {
            const readToken = issueEditStateRef.current.beginRead({ aggregate: true }); setBurnoutLoading(true);
            setBurnoutError('');
            try {
                const response = await requestBurnoutStats(
                    BACKEND_URL,
                    {
                        sprint: sprintLabel,
                        teamIds: burnoutScopedTeamIds,
                        issueKeys: burnoutIssueKeys,
                        includePostSprintClosures: isCompletedSprintSelected
                    },
                    { signal: controller.signal }
                );
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || err.message || `Burndown fetch failed (${response.status})`);
                }
                const payload = await response.json();
                if (cancelled || !issueEditStateRef.current.isCurrentAggregateRead(readToken)) return;
                const data = payload?.data || null;
                burnoutCacheRef.current[burnoutQueryKey] = data;
                setBurnoutData(data);
            } catch (err) {
                if (cancelled) return;
                if (isAuthenticationRequiredError(err)) return;
                if (err.name === 'AbortError') {
                    setBurnoutError('Burndown request timed out (30s). Narrow scope with team or assignee filter.');
                    setBurnoutData(null);
                    return;
                }
                setBurnoutError(String(err.message || err));
                setBurnoutData(null);
            } finally {
                issueEditStateRef.current.finishRead(readToken); window.clearTimeout(timeoutId);
                if (!cancelled) {
                    setBurnoutLoading(false);
                }
            }
        };
        const debounceId = window.setTimeout(() => {
            fetchBurnout();
        }, 120);
        return () => {
            cancelled = true;
            window.clearTimeout(debounceId);
            window.clearTimeout(timeoutId);
            try {
                controller.abort();
            } catch (err) {
                // ignore abort errors
            }
        };
    }, [
        showStats,
        statsView,
        selectedSprintInfo?.name,
        tasksFetched,
        burnoutQueryKey,
        burnoutScopedTeamSignature,
        burnoutIssueKeysSignature,
        isCompletedSprintSelected,
        groupPreferences.onboardingRequired, issuePeopleStatsRevision
    ]);

    useEffect(() => {
        const available = burnoutData?.assignees || [];
        if (!available.length) {
            if (burnoutAssigneeFilter !== 'all') {
                setBurnoutAssigneeFilter('all');
            }
            return;
        }
        if (burnoutAssigneeFilter === 'all') return;
        const exists = available.some((item) => {
            const id = item?.id || item?.name || 'unassigned';
            return id === burnoutAssigneeFilter;
        });
        if (!exists) {
            setBurnoutAssigneeFilter('all');
        }
    }, [burnoutData, burnoutAssigneeFilter]);
    return {
        effectiveStatsData, burnoutTaskTeamByIssueKey, burnoutTaskStatusByIssueKey, burnoutIssueWeightByKey,
        burnoutScopedTeamIds, burnoutScopedTeamSignature, cohortScopedTeamSignature, burnoutQueryKey,
        cohortQueryKey
    };
}

export function useStatsDerivedB({
    scope, BACKEND_URL, EMPTY_ARRAY, EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY,
    activeGroup, activeGroupAdHocCapacityEpics, activeGroupMissingComponents, activeGroupTeamIds,
    adminSettingsGate, availableSprints, burnoutAssigneeFilter, burnoutQueryKey,
    burnoutScopedTeamIds, burnoutScopedTeamSignature, cohortAssigneeFilter, cohortCacheRef,
    cohortData, cohortEndQuarter, cohortExcludeAdHoc, cohortExcludeCapacity,
    cohortGroupBy, cohortProjectFilter, cohortQueryKey, cohortScopedTeamSignature,
    cohortSelectedRow, cohortStartQuarter, cohortStatusToggles, excludedCapacityCacheRef,
    excludedCapacityChartMode, excludedCapacityData, excludedCapacityEndSprintId, excludedCapacityEpicDropdownOpen,
    excludedCapacityEpicDropdownRef, excludedCapacityForceRefreshRef, excludedCapacityIsolatedTeam, excludedCapacityRefreshNonce,
    excludedCapacitySelectedEpicKeys, excludedCapacityStartSprintId, groupPreferences, issueEditStateRef,
    issuePeopleStatsRevision, projectTrackCapacitySide, projectTrackExcludeAdHoc, projectTrackExcludeExcludedCapacity,
    projectTrackMode, projectTrackPhaseAbortRef, projectTrackPhaseCacheRef, projectTrackPhaseData,
    setBurnoutTaskFilter, setCohortAssigneeFilter, setCohortData, setCohortError,
    setCohortLoading, setCohortProjectFilter, setCohortSelectedRow, setEffortSplitVisibleBuckets,
    setExcludedCapacityData, setExcludedCapacityEndSprintId, setExcludedCapacityEpicDropdownOpen, setExcludedCapacityError,
    setExcludedCapacityIsolatedTeam, setExcludedCapacityLoading, setExcludedCapacitySelectedEpicKeys, setExcludedCapacityStartSprintId,
    setProjectTrackPhaseData, setProjectTrackPhaseError, setProjectTrackPhaseLoading, showStats,
    statsView, trackApiResult
}) {
    const {
        activeGroupId, adHocEpicSet, adHocEpicSignature, excludedEpicSet,
        isAllTeamsSelected, selectedSprint, selectedSprintInfo, selectedTeamSet,
        teamNameById, teamOptions, techProjectKeys
    } = scope;
    useEffect(() => {
        if (showStats && statsView === 'burnout') return;
        setBurnoutTaskFilter(null);
    }, [showStats, statsView]);

    useEffect(() => {
        setBurnoutTaskFilter(null);
    }, [selectedSprintInfo?.name, burnoutAssigneeFilter, burnoutQueryKey]);

    useEffect(() => {
        if (!showStats || statsView !== 'cohort') return;
        if (groupPreferences.onboardingRequired || adminSettingsGate.status !== 'clear') { setCohortData(null); setCohortError(''); setCohortLoading(false); return; }
        const startQuarter = String(cohortStartQuarter || '').trim();
        const endQuarter = String(cohortEndQuarter || '').trim();
        if (!startQuarter || !endQuarter) {
            setCohortData(null);
            setCohortError('Start and end quarter are required.');
            setCohortLoading(false);
            return;
        }
        const cached = cohortCacheRef.current[cohortQueryKey];
        if (cached) {
            setCohortData(cached);
            setCohortError('');
            setCohortLoading(false);
            return;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
            try {
                controller.abort();
            } catch (err) {
                // ignore abort errors
            }
        }, 30000);
        let cancelled = false;
        const fetchCohort = async () => {
            const readToken = issueEditStateRef.current.beginRead({ aggregate: true }); setCohortLoading(true);
            setCohortError('');
            try {
                const response = await requestEpicCohortStats(
                    BACKEND_URL,
                    {
                        startQuarter,
                        endQuarter,
                        teamIds: burnoutScopedTeamIds,
                        components: activeGroupMissingComponents,
                        adHocCapacityEpics: activeGroupAdHocCapacityEpics,
                        refresh: false
                    },
                    { signal: controller.signal }
                );
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || err.message || `Lead times fetch failed (${response.status})`);
                }
                const payload = await response.json();
                if (cancelled || !issueEditStateRef.current.isCurrentAggregateRead(readToken)) return;
                const data = payload?.data || null;
                cohortCacheRef.current[cohortQueryKey] = data;
                setCohortData(data);
                setCohortError('');
            } catch (err) {
                if (cancelled) return;
                if (isAuthenticationRequiredError(err)) return;
                if (err?.name === 'AbortError') {
                    setCohortError('Lead times request timed out (30s). Narrow scope with team filters.');
                } else {
                    setCohortError(String(err?.message || err || 'Failed to load lead times data.'));
                }
                setCohortData(null);
            } finally {
                issueEditStateRef.current.finishRead(readToken); window.clearTimeout(timeoutId);
                if (!cancelled) setCohortLoading(false);
            }
        };

        const debounceId = window.setTimeout(fetchCohort, 120);
        return () => {
            cancelled = true;
            window.clearTimeout(debounceId);
            window.clearTimeout(timeoutId);
            try {
                controller.abort();
            } catch (err) {
                // ignore abort errors
            }
        };
    }, [showStats, statsView, cohortStartQuarter, cohortEndQuarter, cohortQueryKey, cohortScopedTeamSignature, burnoutScopedTeamSignature, activeGroupMissingComponents, adHocEpicSignature, groupPreferences.onboardingRequired, adminSettingsGate.status, issuePeopleStatsRevision]);

    const cohortQuarterOptions = React.useMemo(() => {
        return buildQuarterOptions(getCurrentQuarterLabel(), 16);
    }, []);
    const cohortIssues = React.useMemo(() => {
        return Array.isArray(cohortData?.issues) ? cohortData.issues : [];
    }, [cohortData]);
    const cohortProjectOptions = React.useMemo(() => deriveProjectOptions(cohortIssues), [cohortIssues]);
    const cohortAssigneeSourceIssues = React.useMemo(() => {
        if (cohortProjectFilter === 'all') return cohortIssues;
        return cohortIssues.filter((issue) => String(issue?.projectKey || '') === cohortProjectFilter);
    }, [cohortIssues, cohortProjectFilter]);
    const cohortAssigneeOptions = React.useMemo(() => deriveAssigneeOptions(cohortAssigneeSourceIssues), [cohortAssigneeSourceIssues]);
    const cohortFilteredIssues = React.useMemo(() => {
        return filterCohortIssues(cohortIssues, {
            projectKey: cohortProjectFilter,
            assigneeKey: cohortAssigneeFilter,
            excludeAdHoc: cohortExcludeAdHoc,
            excludeEpicKeys: cohortExcludeCapacity ? excludedEpicSet : EMPTY_ARRAY,
            statusToggles: cohortStatusToggles
        });
    }, [cohortIssues, cohortProjectFilter, cohortAssigneeFilter, cohortExcludeAdHoc, cohortExcludeCapacity, cohortStatusToggles, excludedEpicSet]);
    const cohortSummary = React.useMemo(() => aggregateCohortSummary(cohortFilteredIssues), [cohortFilteredIssues]);
    const cohortWorkflowStatusTotal = (cohortSummary.inProgress || 0) + (cohortSummary.postponed || 0) + (cohortSummary.awaitingValidation || 0);
    const cohortGridModel = React.useMemo(() => buildCohortGridModel(cohortFilteredIssues, {
        groupBy: cohortGroupBy,
        maxColumns: cohortGroupBy === 'month' ? 24 : 12,
        rangeStartDate: cohortData?.range?.startDate,
        rangeEndDate: cohortData?.range?.endDate
    }), [cohortFilteredIssues, cohortGroupBy, cohortData?.range?.startDate, cohortData?.range?.endDate]);
    const cohortOpenBars = React.useMemo(() => buildOpenEpicsBars(cohortFilteredIssues, {
        groupBy: cohortGroupBy,
        rowKey: cohortSelectedRow
    }), [cohortFilteredIssues, cohortGroupBy, cohortSelectedRow]);
    const cohortCompletedBars = React.useMemo(() => buildCompletedEpicsBars(cohortFilteredIssues, {
        groupBy: cohortGroupBy,
        rowKey: cohortSelectedRow
    }), [cohortFilteredIssues, cohortGroupBy, cohortSelectedRow]);
    const cohortAverageLeadDays = React.useMemo(() => {
        const resolved = cohortFilteredIssues.filter((issue) => {
            const statusKey = normalizeCohortStatus(issue?.status);
            if (statusKey === 'open') return false;
            return Number.isFinite(Number(issue?.leadTimeDays));
        });
        if (!resolved.length) return null;
        const total = resolved.reduce((sum, issue) => sum + Number(issue?.leadTimeDays || 0), 0);
        return total / resolved.length;
    }, [cohortFilteredIssues]);
    const cohortMedianLeadDays = React.useMemo(() => {
        const values = cohortFilteredIssues
            .filter((issue) => {
                const statusKey = normalizeCohortStatus(issue?.status);
                if (statusKey === 'open') return false;
                return Number.isFinite(Number(issue?.leadTimeDays));
            })
            .map((issue) => Number(issue?.leadTimeDays || 0))
            .sort((a, b) => a - b);
        if (!values.length) return null;
        const middle = Math.floor(values.length / 2);
        if (values.length % 2 === 1) return values[middle];
        return (values[middle - 1] + values[middle]) / 2;
    }, [cohortFilteredIssues]);
    const cohortWarnings = React.useMemo(() => {
        const warnings = cohortData?.meta?.warnings;
        return Array.isArray(warnings) ? warnings : [];
    }, [cohortData]);
    const cohortStatusControls = React.useMemo(() => ([
        { key: 'done', label: 'Done' },
        { key: 'open', label: 'In Progress' },
        { key: 'killed', label: 'Killed' },
        { key: 'incomplete', label: 'Incomplete' },
        { key: 'postponed', label: 'Postponed' }
    ]), []);
    const cohortSelectedRowLabel = React.useMemo(() => {
        if (!cohortSelectedRow) return '';
        const row = (cohortGridModel?.rows || []).find((item) => item.key === cohortSelectedRow);
        return row?.label || cohortSelectedRow;
    }, [cohortGridModel, cohortSelectedRow]);

    useEffect(() => {
        if (cohortProjectFilter === 'all') return;
        const exists = cohortProjectOptions.some((item) => item.value === cohortProjectFilter);
        if (!exists) setCohortProjectFilter('all');
    }, [cohortProjectFilter, cohortProjectOptions]);

    useEffect(() => {
        if (cohortAssigneeFilter === 'all') return;
        const exists = cohortAssigneeOptions.some((item) => item.value === cohortAssigneeFilter);
        if (!exists) setCohortAssigneeFilter('all');
    }, [cohortAssigneeFilter, cohortAssigneeOptions]);

    useEffect(() => {
        if (!cohortSelectedRow) return;
        const exists = (cohortGridModel?.rows || []).some((row) => row.key === cohortSelectedRow);
        if (!exists) {
            setCohortSelectedRow(null);
        }
    }, [cohortGridModel, cohortSelectedRow]);

    const excludedCapacitySprintOptions = React.useMemo(() => {
        return (availableSprints || []).slice().sort(compareSprintsChronologically);
    }, [availableSprints]);
    const excludedCapacityDefaultRange = React.useMemo(() => {
        return buildDefaultExcludedCapacityRange(excludedCapacitySprintOptions, selectedSprint);
    }, [excludedCapacitySprintOptions, selectedSprint]);
    useEffect(() => {
        if (!excludedCapacitySprintOptions.length) return;
        const validIds = new Set(excludedCapacitySprintOptions.map(sprint => String(sprint.id)));
        const nextStart = validIds.has(String(excludedCapacityStartSprintId))
            ? excludedCapacityStartSprintId
            : excludedCapacityDefaultRange.startSprintId;
        const nextEnd = validIds.has(String(excludedCapacityEndSprintId))
            ? excludedCapacityEndSprintId
            : excludedCapacityDefaultRange.endSprintId;
        if (nextStart && nextStart !== excludedCapacityStartSprintId) {
            setExcludedCapacityStartSprintId(nextStart);
        }
        if (nextEnd && nextEnd !== excludedCapacityEndSprintId) {
            setExcludedCapacityEndSprintId(nextEnd);
        }
    }, [
        excludedCapacitySprintOptions,
        excludedCapacityDefaultRange,
        excludedCapacityStartSprintId,
        excludedCapacityEndSprintId
    ]);
    const excludedCapacitySprintRange = React.useMemo(() => {
        return getSprintRange(
            excludedCapacitySprintOptions,
            excludedCapacityStartSprintId,
            excludedCapacityEndSprintId
        );
    }, [excludedCapacitySprintOptions, excludedCapacityStartSprintId, excludedCapacityEndSprintId]);
    const excludedCapacitySprintIds = React.useMemo(() => {
        return excludedCapacitySprintRange.map(sprint => String(sprint.id)).filter(Boolean);
    }, [excludedCapacitySprintRange]);
    const excludedCapacitySprintIdsSignature = React.useMemo(
        () => excludedCapacitySprintIds.join(','),
        [excludedCapacitySprintIds]
    );
    const effortSplitSprintLabel = React.useMemo(() => {
        if (!excludedCapacitySprintRange.length) return 'No sprint range selected';
        const first = excludedCapacitySprintRange[0];
        const last = excludedCapacitySprintRange[excludedCapacitySprintRange.length - 1];
        const firstLabel = first?.name || first?.id || 'Start sprint';
        const lastLabel = last?.name || last?.id || 'End sprint';
        return String(first?.id) === String(last?.id)
            ? String(firstLabel)
            : `${firstLabel} - ${lastLabel}`;
    }, [excludedCapacitySprintRange]);
    const excludedCapacityEpicOptions = React.useMemo(() => {
        return Array.from(excludedEpicSet)
            .filter(key => key && key !== 'NO_EPIC')
            .sort((a, b) => a.localeCompare(b));
    }, [excludedEpicSet]);
    const excludedCapacityScopedTeamIds = React.useMemo(() => {
        if (isAllTeamsSelected) {
            return Array.from(new Set((activeGroupTeamIds || []).map(id => String(id || '').trim()).filter(Boolean))).sort();
        }
        return Array.from(selectedTeamSet).filter(Boolean).sort();
    }, [isAllTeamsSelected, activeGroupTeamIds, selectedTeamSet]);
    const excludedCapacityScopedTeamSignature = React.useMemo(
        () => excludedCapacityScopedTeamIds.join(','),
        [excludedCapacityScopedTeamIds]
    );
    const excludedCapacityTeams = React.useMemo(() => {
        const scoped = excludedCapacityScopedTeamIds.map(teamId => ({
            id: teamId,
            name: teamNameById.get(teamId) || teamId
        }));
        if (scoped.length) return scoped;
        return teamOptions
            .filter(team => team.id && team.id !== 'all')
            .map(team => ({ id: team.id, name: team.name || team.id }));
    }, [excludedCapacityScopedTeamIds, teamNameById, teamOptions]);
    const excludedCapacityQueryKey = React.useMemo(() => {
        if (!excludedCapacitySprintIds.length) return '';
        return `${excludedCapacitySprintIdsSignature}::${excludedCapacityScopedTeamSignature || 'all'}`;
    }, [excludedCapacitySprintIds.length, excludedCapacitySprintIdsSignature, excludedCapacityScopedTeamSignature]);
    useEffect(() => {
        if (!showStats || (statsView !== 'excludedCapacity' && statsView !== 'monoCrossShare' && statsView !== 'projectTrack')) return;
        if (groupPreferences.onboardingRequired || adminSettingsGate.status !== 'clear') { setExcludedCapacityData(null); setExcludedCapacityError(''); setExcludedCapacityLoading(false); return; }
        // The capacity-mix source loads when EITHER excluded capacity OR Ad Hoc
        // epics are configured: Ad Hoc-only groups still get the effort split.
        if (statsView === 'excludedCapacity' && !excludedCapacityEpicOptions.length && adHocEpicSet.size === 0) {
            setExcludedCapacityData(null);
            setExcludedCapacityError('No excluded capacity or Ad Hoc epics are configured for this team group.');
            setExcludedCapacityLoading(false);
            return;
        }
        if (!excludedCapacitySprintIds.length) {
            setExcludedCapacityData(null);
            setExcludedCapacityError('Select a sprint range for excluded capacity analytics.');
            setExcludedCapacityLoading(false);
            return;
        }
        if (activeGroupId && activeGroupTeamIds.length === 0) {
            setExcludedCapacityData(null);
            setExcludedCapacityError('No teams are configured for this team group.');
            setExcludedCapacityLoading(false);
            return;
        }
        const forceRefresh = excludedCapacityForceRefreshRef.current;
        if (forceRefresh) {
            excludedCapacityForceRefreshRef.current = false;
        }
        const rangeCacheKey = `range::${excludedCapacityQueryKey}`;
        const cached = excludedCapacityCacheRef.current[rangeCacheKey];
        if (!forceRefresh && cached) {
            setExcludedCapacityData(cached);
            setExcludedCapacityError('');
            setExcludedCapacityLoading(false);
            return;
        }

        let cancelled = false, readToken;
        const controllers = new Set();
        const sprintCacheKeyFor = (sprintId) => `sprint::${String(sprintId || '').trim()}::${excludedCapacityScopedTeamSignature || 'all'}`;
        const fetchSprintChunk = async (sprintId) => {
            const sprintCacheKey = sprintCacheKeyFor(sprintId);
            const cachedSprint = excludedCapacityCacheRef.current[sprintCacheKey];
            if (!forceRefresh && cachedSprint) return cachedSprint;
            const controller = new AbortController();
            controllers.add(controller);
            let timedOut = false;
            const timeoutId = window.setTimeout(() => {
                timedOut = true;
                try {
                    controller.abort();
                } catch (err) {
                    // ignore abort errors
                }
            }, 30000);
            try {
                const response = await requestExcludedCapacityStatsSource(BACKEND_URL, {
                    sprintIds: [sprintId],
                    teamIds: excludedCapacityScopedTeamIds,
                    refresh: forceRefresh,
                    signal: controller.signal
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || err.message || `Excluded capacity fetch failed (${response.status})`);
                }
                const payload = await response.json();
                const data = payload?.data || null;
                if (data && issueEditStateRef.current.isCurrentAggregateRead(readToken)) {
                    excludedCapacityCacheRef.current[sprintCacheKey] = data;
                }
                return data;
            } catch (err) {
                if (isAuthenticationRequiredError(err)) throw err;
                if (err?.name === 'AbortError' && timedOut) {
                    const timeoutError = new Error('request timed out after 30s');
                    timeoutError.name = 'ExcludedCapacitySprintTimeout';
                    throw timeoutError;
                }
                throw err;
            } finally {
                window.clearTimeout(timeoutId);
                controllers.delete(controller);
            }
        };
        const loadExcludedCapacity = async () => {
            readToken = issueEditStateRef.current.beginRead({ aggregate: true }); setExcludedCapacityLoading(true);
            setExcludedCapacityError('');
            const analyticsStartedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            try {
                const result = await loadExcludedCapacityStatsSourceChunks(excludedCapacitySprintIds, fetchSprintChunk, {
                    maxConcurrent: EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY,
                    isCancelled: () => cancelled,
                    onProgress: (chunks, progressMeta) => {
                        if (cancelled || !issueEditStateRef.current.isCurrentAggregateRead(readToken)) return;
                        setExcludedCapacityData(mergeExcludedCapacityStatsSourceChunks(chunks, {
                            loadedSprintCount: progressMeta.loadedSprintCount,
                            totalSprintCount: progressMeta.totalSprintCount
                        }));
                    }
                });
                if (cancelled || !issueEditStateRef.current.isCurrentAggregateRead(readToken)) return;
                if (result.errors.length === excludedCapacitySprintIds.length) {
                    throw new Error('Excluded capacity source failed for all selected sprints.');
                }
                const data = mergeExcludedCapacityStatsSourceChunks(result.chunks, {
                    loadedSprintCount: result.chunks.length,
                    totalSprintCount: excludedCapacitySprintIds.length
                });
                excludedCapacityCacheRef.current[rangeCacheKey] = data;
                setExcludedCapacityData(data);
                trackApiResult('stats_source', { featureName: 'stats', method: 'POST', status: 200, durationMs: (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - analyticsStartedAt, cacheState: forceRefresh ? 'refresh' : 'unknown' });
            } catch (err) {
                if (cancelled) return;
                if (isAuthenticationRequiredError(err)) return;
                if (err?.name === 'AbortError') {
                    setExcludedCapacityError('Excluded capacity sprint request timed out (30s). Narrow the sprint range or team filter.');
                } else {
                    setExcludedCapacityError(String(err?.message || err || 'Failed to load excluded capacity data.'));
                }
                setExcludedCapacityData(null);
                trackApiResult('stats_source', { featureName: 'stats', method: 'POST', status: 500, durationMs: (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - analyticsStartedAt, cacheState: forceRefresh ? 'refresh' : 'unknown' });
            } finally {
                issueEditStateRef.current.finishRead(readToken); if (!cancelled) setExcludedCapacityLoading(false);
            }
        };
        const debounceId = window.setTimeout(loadExcludedCapacity, 120);
        return () => {
            cancelled = true;
            window.clearTimeout(debounceId);
            controllers.forEach(controller => {
                try {
                    controller.abort();
                } catch (err) {
                    // ignore abort errors
                }
            });
            controllers.clear();
        };
    }, [
        showStats,
        statsView,
        excludedCapacityQueryKey,
        excludedCapacitySprintIdsSignature,
        excludedCapacityScopedTeamSignature,
        excludedCapacityEpicOptions,
        adHocEpicSignature,
        activeGroupId,
        activeGroupTeamIds.length,
        excludedCapacityRefreshNonce,
        groupPreferences.onboardingRequired,
        adminSettingsGate.status
    ]);
    const excludedCapacityIssues = React.useMemo(() => {
        return Array.isArray(excludedCapacityData?.issues) ? excludedCapacityData.issues : [];
    }, [excludedCapacityData]);
    // Project Track reuses the already-loaded stats-source stories and the shared
    // Excluded Capacity sprint range; no new fetch. Logic lives in projectTrackStats.js.
    const projectTrackSprintOrder = React.useMemo(
        () => excludedCapacitySprintRange.map((sprint) => String(sprint.id)),
        [excludedCapacitySprintRange]
    );
    const projectTrackOpts = React.useMemo(() => ({
        capacitySide: projectTrackCapacitySide,
        mode: projectTrackMode,
        excludeAdHoc: projectTrackExcludeAdHoc,
        excludeExcludedCapacity: projectTrackExcludeExcludedCapacity,
        techProjectKeys,
        adHocEpicSet,
        excludedEpicSet,
        sprintOrder: projectTrackSprintOrder
    }), [
        projectTrackCapacitySide,
        projectTrackMode,
        projectTrackExcludeAdHoc,
        projectTrackExcludeExcludedCapacity,
        techProjectKeys,
        adHocEpicSet,
        excludedEpicSet,
        projectTrackSprintOrder
    ]);
    const projectTrackSeries = React.useMemo(
        () => buildProjectTrackSprintSeries(excludedCapacityIssues, projectTrackOpts),
        [excludedCapacityIssues, projectTrackOpts]
    );
    const projectTrackTotals = React.useMemo(
        () => summarizeProjectTrackTotals(projectTrackSeries),
        [projectTrackSeries]
    );
    const projectTrackBreakdown = React.useMemo(
        () => buildProjectTrackBreakdownRows(excludedCapacityIssues, projectTrackOpts),
        [excludedCapacityIssues, projectTrackOpts]
    );
    const projectTrackBoardColumns = activeGroup?.board?.columns;
    const projectTrackColumnSplit = React.useMemo(() => (projectTrackMode === 'team'
        ? buildProjectTrackColumnSplit(excludedCapacityIssues, projectTrackOpts, projectTrackBoardColumns) : null
    ), [projectTrackMode, excludedCapacityIssues, projectTrackOpts, projectTrackBoardColumns]);
    const projectTrackRangeLabel = React.useMemo(() => {
        const range = excludedCapacitySprintRange;
        if (!range.length) return '';
        const first = range[0];
        const last = range[range.length - 1];
        const firstName = first.name || String(first.id);
        const lastName = last.name || String(last.id);
        return range.length === 1 ? firstName : `${firstName} – ${lastName}`;
    }, [excludedCapacitySprintRange]);
    // Epic key set for the time-in-phase section (Epic mode only).
    // Uses inScopeEpicKeys which calls withAllowed(opts) internally so the
    // sprint-range guard is applied (allowedSprintIds derived from sprintOrder).
    const projectTrackPhaseEpicKeys = React.useMemo(() => {
        if (projectTrackMode !== 'epic') return [];
        return projectTrackInScopeEpicKeys(excludedCapacityIssues, projectTrackOpts).sort();
    }, [projectTrackMode, excludedCapacityIssues, projectTrackOpts]);
    const projectTrackPhaseSignature = projectTrackPhaseEpicKeys.join(',');
    useEffect(() => {
        if (!showStats || statsView !== 'projectTrack' || projectTrackMode !== 'epic') {
            return;
        }
        if (!projectTrackPhaseEpicKeys.length) {
            setProjectTrackPhaseData(null);
            setProjectTrackPhaseError('');
            setProjectTrackPhaseLoading(false);
            return;
        }
        const cached = projectTrackPhaseCacheRef.current[projectTrackPhaseSignature];
        if (cached) {
            setProjectTrackPhaseData(cached);
            setProjectTrackPhaseError('');
            setProjectTrackPhaseLoading(false);
            return;
        }
        if (projectTrackPhaseAbortRef.current) {
            try { projectTrackPhaseAbortRef.current.abort(); } catch (_) { /* ignore */ }
        }
        const controller = new AbortController();
        projectTrackPhaseAbortRef.current = controller;
        let cancelled = false;
        const load = async () => {
            setProjectTrackPhaseLoading(true);
            setProjectTrackPhaseError('');
            try {
                const response = await requestProjectTrackPhaseDurations(BACKEND_URL, {
                    epicKeys: projectTrackPhaseEpicKeys,
                    signal: controller.signal,
                });
                if (cancelled) return;
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || err.message || `Phase durations fetch failed (${response.status})`);
                }
                const payload = await response.json();
                if (cancelled) return;
                projectTrackPhaseCacheRef.current[projectTrackPhaseSignature] = payload;
                setProjectTrackPhaseData(payload);
                setProjectTrackPhaseError('');
            } catch (err) {
                if (cancelled || err?.name === 'AbortError') return;
                if (isAuthenticationRequiredError(err)) return;
                setProjectTrackPhaseError(String(err?.message || err || 'Failed to load phase duration data.'));
                setProjectTrackPhaseData(null);
            } finally {
                if (!cancelled) setProjectTrackPhaseLoading(false);
            }
        };
        const debounceId = window.setTimeout(load, 120);
        return () => {
            cancelled = true;
            window.clearTimeout(debounceId);
            try { controller.abort(); } catch (_) { /* ignore */ }
        };
    }, [
        showStats,
        statsView,
        projectTrackMode,
        projectTrackPhaseSignature,
    ]);
    const projectTrackPhaseEpics = React.useMemo(
        () => Array.isArray(projectTrackPhaseData?.epics) ? projectTrackPhaseData.epics : [],
        [projectTrackPhaseData]
    );
    const projectTrackPhaseSummary = React.useMemo(
        () => summarizeTrackPhaseDurations(projectTrackPhaseEpics),
        [projectTrackPhaseEpics]
    );
    const excludedCapacityEpicCatalog = React.useMemo(() => {
        return buildExcludedEpicCatalog(excludedCapacityIssues, {
            excludedEpicKeys: excludedCapacityEpicOptions
        });
    }, [excludedCapacityIssues, excludedCapacityEpicOptions]);
    // Preference migration: a null saved value (no prior selection, or the
    // removed BAU/ad-hoc preset) defaults to ALL configured excluded epics.
    useEffect(() => {
        if (excludedCapacitySelectedEpicKeys === null && excludedCapacityEpicOptions.length) {
            setExcludedCapacitySelectedEpicKeys(excludedCapacityEpicOptions.slice());
        }
    }, [excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]);
    useEffect(() => {
        // Drop only excluded keys no longer in the catalog; keep valid ones.
        if (!Array.isArray(excludedCapacitySelectedEpicKeys)) return;
        const valid = new Set(excludedCapacityEpicOptions);
        const filtered = excludedCapacitySelectedEpicKeys.filter(key => valid.has(key));
        if (filtered.length !== excludedCapacitySelectedEpicKeys.length) {
            setExcludedCapacitySelectedEpicKeys(filtered);
        }
    }, [excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]);
    const excludedCapacityEffectiveFilters = React.useMemo(() => {
        if (!Array.isArray(excludedCapacitySelectedEpicKeys)) return [];
        return excludedCapacitySelectedEpicKeys.filter(key => excludedCapacityEpicOptions.includes(key));
    }, [excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]);
    const excludedCapacityFilterLabel = React.useMemo(() => {
        if (excludedCapacityEffectiveFilters.length === 0) {
            return `Filter: All configured (${excludedCapacityEpicOptions.length})`;
        }
        return `Filter: ${excludedCapacityEffectiveFilters.length} of ${excludedCapacityEpicOptions.length} selected`;
    }, [excludedCapacityEffectiveFilters, excludedCapacityEpicOptions]);
    const excludedCapacityActiveFilters = excludedCapacityEffectiveFilters.length
        ? excludedCapacityEffectiveFilters
        : excludedCapacityEpicOptions;
    const effortSplitRows = React.useMemo(() => {
        return buildEffortTypeSplitRows(excludedCapacityIssues, excludedCapacitySprintRange, {
            excludedEpicKeys: excludedCapacityEpicOptions,
            excludedEpicKeyFilters: excludedCapacityActiveFilters,
            adHocEpicKeys: Array.from(adHocEpicSet),
            teams: excludedCapacityTeams,
            techProjectKeys: Array.from(techProjectKeys)
        });
    }, [
        excludedCapacityIssues,
        excludedCapacitySprintRange,
        excludedCapacityEpicOptions,
        excludedCapacityActiveFilters,
        adHocEpicSet,
        adHocEpicSignature,
        excludedCapacityTeams,
        techProjectKeys
    ]);
    const excludedCapacityRows = React.useMemo(() => {
        return buildExcludedCapacityTimeSeries(excludedCapacityIssues, excludedCapacitySprintRange, {
            excludedEpicKeys: excludedCapacityEpicOptions,
            excludedEpicKeyFilters: excludedCapacityActiveFilters,
            teams: excludedCapacityTeams
        });
    }, [
        excludedCapacityIssues,
        excludedCapacitySprintRange,
        excludedCapacityEpicOptions,
        excludedCapacityActiveFilters,
        excludedCapacityTeams
    ]);
    const excludedCapacityLineSeries = React.useMemo(() => {
        return buildExcludedCapacityLineSeries(excludedCapacityIssues, excludedCapacitySprintRange, {
            excludedEpicKeys: excludedCapacityEpicOptions,
            excludedEpicKeyFilters: excludedCapacityActiveFilters,
            teams: excludedCapacityTeams,
            mode: excludedCapacityChartMode,
            groupName: activeGroup?.name || 'Group'
        });
    }, [
        excludedCapacityIssues,
        excludedCapacitySprintRange,
        excludedCapacityEpicOptions,
        excludedCapacityActiveFilters,
        excludedCapacityTeams,
        excludedCapacityChartMode,
        activeGroup?.name
    ]);
    const excludedCapacityModeOverall = React.useMemo(() => {
        return buildEpicTeamModeOverall(excludedCapacityIssues, {
            includeAllEpics: true,
            sprints: excludedCapacitySprintRange,
            teams: excludedCapacityTeams
        });
    }, [
        excludedCapacityIssues,
        excludedCapacitySprintRange,
        excludedCapacityTeams
    ]);
    const excludedCapacityModeSprintRows = React.useMemo(() => {
        return buildEpicTeamModeSprintRows(excludedCapacityIssues, {
            includeAllEpics: true,
            sprints: excludedCapacitySprintRange
        });
    }, [
        excludedCapacityIssues,
        excludedCapacitySprintRange
    ]);
    const excludedCapacityModeTeamLineSeries = React.useMemo(() => {
        return buildEpicTeamCrossShareLineSeries(excludedCapacityIssues, excludedCapacitySprintRange, {
            teams: excludedCapacityTeams
        });
    }, [
        excludedCapacityIssues,
        excludedCapacitySprintRange,
        excludedCapacityTeams
    ]);
    const excludedCapacityIsolatedSeries = statsView === 'monoCrossShare' ? excludedCapacityModeTeamLineSeries.series : excludedCapacityLineSeries.series;
    const effortSplitTotals = React.useMemo(() => summarizeEffortTypeSplitTotals(effortSplitRows), [effortSplitRows]);
    const excludedCapacityWarnings = React.useMemo(() => {
        const warnings = excludedCapacityData?.meta?.warnings;
        return Array.isArray(warnings) ? warnings : [];
    }, [excludedCapacityData]);
    useEffect(() => {
        if (statsView === 'excludedCapacity' && excludedCapacityChartMode !== 'teams' && excludedCapacityIsolatedTeam) {
            setExcludedCapacityIsolatedTeam(null);
            return;
        }
        if (!excludedCapacityIsolatedTeam) return;
        const known = new Set((excludedCapacityIsolatedSeries || []).map(item => item.seriesId));
        if (!known.has(excludedCapacityIsolatedTeam)) {
            setExcludedCapacityIsolatedTeam(null);
        }
    }, [statsView, excludedCapacityChartMode, excludedCapacityIsolatedTeam, excludedCapacityIsolatedSeries]);
    const formatExcludedPoints = (value) => {
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) return '0.0';
        return numeric.toFixed(1);
    };
    const toggleExcludedCapacityEpicKey = (epicKey) => {
        const normalized = String(epicKey || '').trim().toUpperCase();
        if (!normalized) return;
        setExcludedCapacitySelectedEpicKeys(prev => {
            const base = Array.isArray(prev) ? prev.slice() : [];
            const index = base.indexOf(normalized);
            if (index >= 0) base.splice(index, 1);
            else base.push(normalized);
            return base;
        });
    };
    const clearExcludedCapacityEpicSelection = () => {
        setExcludedCapacitySelectedEpicKeys([]);
    };
    const selectAllExcludedCapacityEpics = () => {
        setExcludedCapacitySelectedEpicKeys(excludedCapacityEpicOptions.slice());
    };
    const toggleEffortSplitBucket = (bucketKey) => {
        setEffortSplitVisibleBuckets(prev => ({
            ...prev,
            [bucketKey]: prev[bucketKey] === false
        }));
    };
    useEffect(() => {
        if (!excludedCapacityEpicDropdownOpen) return;
        const handleClickOutside = (event) => {
            const node = excludedCapacityEpicDropdownRef.current;
            if (node && !node.contains(event.target)) {
                setExcludedCapacityEpicDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [excludedCapacityEpicDropdownOpen]);
    return {
        cohortQuarterOptions, cohortProjectOptions, cohortAssigneeOptions, cohortSummary,
        cohortWorkflowStatusTotal, cohortGridModel, cohortOpenBars, cohortCompletedBars,
        cohortAverageLeadDays, cohortMedianLeadDays, cohortWarnings, cohortStatusControls,
        cohortSelectedRowLabel, excludedCapacitySprintOptions, excludedCapacitySprintRange, effortSplitSprintLabel,
        excludedCapacityEpicOptions, projectTrackSeries, projectTrackTotals, projectTrackBreakdown,
        projectTrackColumnSplit, projectTrackRangeLabel, projectTrackPhaseEpics, projectTrackPhaseSummary,
        excludedCapacityEpicCatalog, excludedCapacityEffectiveFilters, excludedCapacityFilterLabel, effortSplitRows,
        excludedCapacityRows, excludedCapacityLineSeries, excludedCapacityModeOverall, excludedCapacityModeSprintRows,
        excludedCapacityModeTeamLineSeries, effortSplitTotals, excludedCapacityWarnings, formatExcludedPoints,
        toggleExcludedCapacityEpicKey, clearExcludedCapacityEpicSelection, selectAllExcludedCapacityEpics, toggleEffortSplitBucket
    };
}

export function useStatsDerivedC({
    scope, burndownMetric, burnoutAssigneeFilter, burnoutData, burnoutIssueWeightByKey, burnoutTaskStatusByIssueKey, burnoutTaskTeamByIssueKey,
    effectivePriorityWeightMap, effectiveStatsData, isBurnoutClosedStatus, isCompletedSprintSelected,
    priorityAxis, priorityOrder, resolveStatsTeamColor, showStats,
    statsView
}) {
    const {
        isAllTeamsSelected, selectedTeamSet, teamNameById, teamOptions
    } = scope;
    const statsTeams = effectiveStatsData?.teams || [];
    const allowedStatsTeamIds = React.useMemo(() => {
        if (!isAllTeamsSelected) {
            return new Set(Array.from(selectedTeamSet));
        }
        return null;
    }, [isAllTeamsSelected, selectedTeamSet]);

    const filteredStatsTeams = statsTeams.filter(team => {
        if (!allowedStatsTeamIds) return true;
        const id = team.id || team.name || 'unknown';
        return allowedStatsTeamIds.has(id);
    });

    const priorityTeamIds = React.useMemo(() => {
        if (!isAllTeamsSelected) {
            return Array.from(selectedTeamSet);
        }
        return teamOptions
            .map(team => team.id)
            .filter(id => id && id !== 'all');
    }, [isAllTeamsSelected, selectedTeamSet, teamOptions]);

    const getStatsTeamLabel = (team) => {
        if (!team) return 'Unknown Team';
        if (!isAllTeamsSelected && team.id && teamNameById.has(team.id)) {
            return teamNameById.get(team.id);
        }
        return team.name || team.id || 'Unknown Team';
    };

    const priorityRows = React.useMemo(() => {
        const totals = {};
        const pointsTotals = {};
        (filteredStatsTeams || []).forEach(team => {
            Object.entries(team.priorities || {}).forEach(([priorityName, counts]) => {
                const label = getPriorityLabel(priorityName);
                if (!totals[label]) {
                    totals[label] = { done: 0, incomplete: 0, killed: 0 };
                }
                totals[label].done += counts.done || 0;
                totals[label].incomplete += counts.incomplete || 0;
                totals[label].killed += counts.killed || 0;
            });
            Object.entries(team.priorityPoints || {}).forEach(([priorityName, points]) => {
                const label = getPriorityLabel(priorityName);
                pointsTotals[label] = (pointsTotals[label] || 0) + (points || 0);
            });
        });
        return Object.entries(totals)
            .map(([name, counts]) => ({
                name,
                done: counts.done,
                incomplete: counts.incomplete,
                killed: counts.killed,
                rate: computeRate(counts),
                points: pointsTotals[name] || 0
            }))
            .sort((a, b) => {
                const orderA = priorityOrder[a.name] || 999;
                const orderB = priorityOrder[b.name] || 999;
                if (orderA !== orderB) return orderA - orderB;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
    }, [filteredStatsTeams, priorityOrder]);

    const priorityRadar = React.useMemo(() => {
        const series = (filteredStatsTeams || []).map(team => {
            const pointsByPriority = {};
            Object.entries(team.priorityPoints || {}).forEach(([priorityName, points]) => {
                const label = getPriorityLabel(priorityName);
                pointsByPriority[label] = (pointsByPriority[label] || 0) + (points || 0);
            });
            return {
                id: team.id || team.name || 'unknown',
                name: getStatsTeamLabel(team),
                pointsByPriority
            };
        });
        const maxValue = Math.max(
            1,
            ...series.flatMap(item => priorityAxis.map(axis => item.pointsByPriority[axis] || 0))
        );
        return { series, maxValue };
    }, [filteredStatsTeams, getStatsTeamLabel, priorityAxis]);

    const getTeamScopedMetrics = (team, projectKey = 'all') => {
        if (!team) {
            return { done: 0, incomplete: 0, killed: 0, priorities: {} };
        }
        if (projectKey === 'all') {
            return {
                done: team.done || 0,
                incomplete: team.incomplete || 0,
                killed: team.killed || 0,
                priorities: team.priorities || {}
            };
        }
        const projectScope = team.projects?.[projectKey];
        return {
            done: projectScope?.done || 0,
            incomplete: projectScope?.incomplete || 0,
            killed: projectScope?.killed || 0,
            priorities: projectScope?.priorities || {}
        };
    };

    const statsTeamRows = filteredStatsTeams.map(team => {
        const scoped = getTeamScopedMetrics(team);
        const scopedProduct = getTeamScopedMetrics(team, 'product');
        const scopedTech = getTeamScopedMetrics(team, 'tech');
        const weighted = computePriorityWeighted(scoped.priorities, effectivePriorityWeightMap);
        const weightedProduct = computePriorityWeighted(scopedProduct.priorities, effectivePriorityWeightMap);
        const weightedTech = computePriorityWeighted(scopedTech.priorities, effectivePriorityWeightMap);
        const straightRate = computeRate(scoped);
        const weightedRate = computeRate(weighted);
        return {
            id: team.id || team.name || 'unknown',
            name: getStatsTeamLabel(team),
            straight: scoped,
            product: scopedProduct,
            tech: scopedTech,
            weighted,
            weightedProduct,
            weightedTech,
            straightRate,
            weightedRate,
            priorityPoints: team.priorityPoints || {}
        };
    });
    const statsBarColumns = (() => {
        const teamCount = statsTeamRows.length;
        if (teamCount <= 0) return 1;
        if (teamCount > 8) return 6;
        return teamCount;
    })();

    const statsTotals = statsTeamRows.reduce((acc, row) => {
        acc.straight.done += row.straight.done;
        acc.straight.incomplete += row.straight.incomplete;
        acc.straight.killed += row.straight.killed;
        acc.product.done += row.product.done;
        acc.product.incomplete += row.product.incomplete;
        acc.product.killed += row.product.killed;
        acc.tech.done += row.tech.done;
        acc.tech.incomplete += row.tech.incomplete;
        acc.tech.killed += row.tech.killed;
        acc.weighted.done += row.weighted.done;
        acc.weighted.incomplete += row.weighted.incomplete;
        acc.weighted.killed += row.weighted.killed;
        acc.weightedProduct.done += row.weightedProduct.done;
        acc.weightedProduct.incomplete += row.weightedProduct.incomplete;
        acc.weightedProduct.killed += row.weightedProduct.killed;
        acc.weightedTech.done += row.weightedTech.done;
        acc.weightedTech.incomplete += row.weightedTech.incomplete;
        acc.weightedTech.killed += row.weightedTech.killed;
        return acc;
    }, {
        straight: { done: 0, incomplete: 0, killed: 0 },
        product: { done: 0, incomplete: 0, killed: 0 },
        tech: { done: 0, incomplete: 0, killed: 0 },
        weighted: { done: 0, incomplete: 0, killed: 0 },
        weightedProduct: { done: 0, incomplete: 0, killed: 0 },
        weightedTech: { done: 0, incomplete: 0, killed: 0 }
    });
    const burnoutAssigneeOptions = React.useMemo(() => {
        const source = burnoutData?.assignees || [];
        const rows = source.map((item) => {
            const value = item?.id || item?.name || 'unassigned';
            const label = item?.name || 'Unassigned';
            return {
                value,
                label,
                events: Number(item?.events || 0)
            };
        });
        return [{ value: 'all', label: 'All Assignees', events: 0 }, ...rows];
    }, [burnoutData]);

    const burnoutChartModel = React.useMemo(() => buildBurnoutChartModel({
        burnoutData,
        assigneeFilter: burnoutAssigneeFilter,
        taskTeamByIssueKey: burnoutTaskTeamByIssueKey,
        taskStatusByIssueKey: burnoutTaskStatusByIssueKey,
        issueWeightByKey: burnoutIssueWeightByKey,
        isCompletedSprintSelected,
        metric: burndownMetric,
        resolveTeamColor: resolveStatsTeamColor,
        isClosedStatus: isBurnoutClosedStatus
    }), [
        burnoutData,
        burnoutAssigneeFilter,
        burnoutTaskTeamByIssueKey,
        burnoutTaskStatusByIssueKey,
        burnoutIssueWeightByKey,
        isCompletedSprintSelected,
        burndownMetric,
        isBurnoutClosedStatus,
        resolveStatsTeamColor
    ]);

    const burnoutTotals = burnoutChartModel?.summary || {
        start: 0,
        added: 0,
        closed: 0,
        remaining: 0,
        closureBuckets: { done: 0, killed: 0, incomplete: 0 }
    };
    const burndownMetricIsStoryPoints = burndownMetric === 'storyPoints';
    const formatBurndownValue = React.useCallback((value) => {
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) return burndownMetricIsStoryPoints ? '0.0' : '0';
        return burndownMetricIsStoryPoints ? numeric.toFixed(1) : String(Math.round(numeric));
    }, [burndownMetricIsStoryPoints]);

    const buildBurnoutTaskFilter = React.useCallback((dateKey, teamKey = null) => {
        if (!burnoutChartModel || !dateKey) return null;
        const snapshots = Array.isArray(burnoutChartModel.issueSnapshots) ? burnoutChartModel.issueSnapshots : [];
        const issueKeys = [];
        snapshots.forEach((snapshot) => {
            const issueKey = String(snapshot?.issueKey || '').trim().toUpperCase();
            if (!issueKey) return;
            const createdDateKey = String(snapshot?.createdDateKey || '').trim();
            const closureDateKey = String(snapshot?.closureDateKey || '').trim();
            if (!createdDateKey || createdDateKey > dateKey) return;
            if (closureDateKey && closureDateKey <= dateKey) return;
            if (teamKey && snapshot?.openTeamKey !== teamKey) return;
            issueKeys.push(issueKey);
        });
        const teamName = teamKey ? (burnoutChartModel.teamNameByKey?.[teamKey] || 'Unknown Team') : 'All teams';
        return {
            dateKey,
            teamKey: teamKey || null,
            teamName,
            issueKeys
        };
    }, [burnoutChartModel]);

    const canRenderStatsPanel = Boolean(effectiveStatsData) || statsView === 'burnout' || statsView === 'cohort' || statsView === 'excludedCapacity' || statsView === 'monoCrossShare' || statsView === 'projectTrack';
    const isLeadTimesFocusMode = showStats && statsView === 'cohort';
    return {
        priorityTeamIds, priorityRows, priorityRadar, statsTeamRows,
        statsBarColumns, statsTotals, burnoutAssigneeOptions, burnoutChartModel,
        burnoutTotals, burndownMetricIsStoryPoints, formatBurndownValue,
        buildBurnoutTaskFilter, canRenderStatsPanel, isLeadTimesFocusMode
    };
}
