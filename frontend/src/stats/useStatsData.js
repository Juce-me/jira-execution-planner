import React, { useEffect } from 'react';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { aggregateCohortSummary, buildCohortGridModel, buildCohortRequest, buildCompletedEpicsBars, buildOpenEpicsBars, buildQuarterOptions, createdRangeOf, deriveProjectOptions, filterCohortIssues, getCurrentQuarterLabel, normalizeCohortStatus, selectLastClosedEpics } from '../cohort/cohortUtils.js';
import { buildDefaultExcludedCapacityRange, buildEpicTeamCrossShareLineSeries, buildEpicTeamModeOverall, buildEpicTeamModeSprintRows, buildEffortTypeSplitRows, buildExcludedCapacityLineSeries, buildExcludedCapacityTimeSeries, buildExcludedEpicCatalog, getSprintRange, loadExcludedCapacityStatsSourceChunks, mergeExcludedCapacityStatsSourceChunks, sortSprintsNewestFirst, summarizeEffortTypeSplitTotals } from './excludedCapacityStats.js';
import { buildBurnoutChartModel } from './burnoutChartUtils.js';
import { buildLocalStatsFromTasks, computePriorityWeighted, computeRate, getPriorityLabel } from './statsUtils.js';
import { buildProjectTrackSprintSeries, summarizeProjectTrackTotals, buildProjectTrackBreakdownRows, buildProjectTrackColumnSplit, inScopeEpicKeys as projectTrackInScopeEpicKeys } from './projectTrackStats.js';
import { summarizeTrackPhaseDurations } from './projectTrackPhaseStats.js';
import { fetchExcludedCapacityStatsSource as requestExcludedCapacityStatsSource } from '../api/engApi.js';
import { fetchBurnoutStats as requestBurnoutStats, fetchEpicCohortStats as requestEpicCohortStats, fetchProjectTrackPhaseDurations as requestProjectTrackPhaseDurations } from '../api/statsApi.js';

// Automatic acquisitions keep payloads private until the aggregate edit fence and job both accept them.
const automaticStatsAttempts = new WeakSet();
function runAutomaticStatsRead(automatic, source, issueEditStateRef, request, commit) {
    // A dependency replacement retires this attempt; it must not launch a second read under the same adapter promise.
    if (automaticStatsAttempts.has(automatic)) return () => {};
    automaticStatsAttempts.add(automatic);
    const started = Date.now(), controller = new AbortController();
    let cancelled = false, settled = false;
    const outcome = (status, checkKind = 'unknown') => [{ source, status, checkKind, coverage: 'unknown', requestStartedAtMs: started, retryAtMs: null }];
    const settle = (value, error) => { if (!settled) { settled = true; automatic.settle(value, error); } };
    const abort = () => { controller.abort(); settle(outcome('ignored')); };
    automatic.job.signal.addEventListener('abort', abort, { once: true });
    const current = () => !cancelled && !controller.signal.aborted && automatic.job.shouldApply();
    if (!current()) { abort(); automatic.job.signal.removeEventListener('abort', abort); return () => {}; }
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    const debounce = window.setTimeout(async () => {
        if (!current()) { settle(outcome('ignored')); return; }
        const readToken = issueEditStateRef.current.beginRead({ aggregate: true });
        try {
            const response = await request(controller.signal);
            if (!response.ok) {
                const error = new Error(`Statistics source failed (${response.status})`); error.status = response.status; throw error;
            }
            const payload = await response.json();
            if (!payload || !payload.data) throw new Error('Statistics source returned no data');
            if (!current() || !issueEditStateRef.current.isCurrentAggregateRead(readToken)) { settle(outcome('ignored')); return; }
            if (commit(payload.data) === false) { settle(outcome('failed')); return; }
            settle(outcome('ok', source === 'stats_burnout' ? 'unknown' : payload.cached === true ? 'cached' : payload.cached === false ? 'forced' : 'unknown'));
        } catch (error) {
            // HTTP publishes the terminal mounted lock before this owner sees the exception.
            if (isAuthenticationRequiredError(error)) { settle([], error); return; }
            settle(outcome(cancelled || !automatic.job.shouldApply() || automatic.job.signal.aborted ? 'ignored' : error.status === 429 ? 'rate_limited' : 'failed'));
        } finally {
            issueEditStateRef.current.finishRead(readToken);
            window.clearTimeout(timeout);
            automatic.job.signal.removeEventListener('abort', abort);
        }
    }, 120);
    return () => {
        const interrupted = !settled && automatic.job.shouldApply();
        cancelled = true; window.clearTimeout(debounce); window.clearTimeout(timeout); abort(); automatic.job.signal.removeEventListener('abort', abort);
        if (interrupted) automatic.job.resumeAfterInterruption?.();
    };
}

export function useStatsDerivedA({
    scope, automaticRefreshRef, BACKEND_URL, activeGroupMissingComponents, activeGroupTeamIds,
    activeGroupTeamSet, burnoutAssigneeFilter, burnoutCacheRef, burnoutData,
    cohortClosedEndQuarter, cohortClosedStartQuarter, cohortEndQuarter, cohortMode, cohortStartQuarter,
    getTeamInfo, groupPreferences,
    isCompletedSprintSelected, issueEditStateRef, issuePeopleStatsRevision, normalizeEpicKey,
    normalizeStatus, perfCountersRef, perfEnabled, setBurnoutAssigneeFilter,
    setBurnoutData, setBurnoutError, setBurnoutLoading, showStats,
    statsView, tasksFetched
}) {
    const {
        adHocEpicSet, adHocEpicSignature, capacityTasks, excludedEpicSet,
        isAllTeamsSelected, selectedSprintInfo, selectedTeamSet, techProjectKeys
    } = scope;
    const automaticBurnoutDataRef = React.useRef(null);
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
        // Created keeps its original key; the closed modes prefix theirs, and Last N is keyed by scope alone (N is client-only).
        const scopeKey = `${cohortScopedTeamSignature}::${adHocEpicSignature || 'no-adhoc'}`;
        if (cohortMode === 'last_n') return `last_n::::::${scopeKey}`;
        const closedMode = cohortMode === 'closed';
        const startQuarter = String((closedMode ? cohortClosedStartQuarter : cohortStartQuarter) || '').trim();
        const endQuarter = String((closedMode ? cohortClosedEndQuarter : cohortEndQuarter) || '').trim();
        if (!startQuarter || !endQuarter) return '';
        const key = `${startQuarter}::${endQuarter}::${scopeKey}`;
        return closedMode ? `closed::${key}` : key;
    }, [cohortMode, cohortStartQuarter, cohortEndQuarter, cohortClosedStartQuarter, cohortClosedEndQuarter, cohortScopedTeamSignature, adHocEpicSignature]);

    useEffect(() => {
        if (!showStats || statsView !== 'burnout') return;
        const automatic = automaticRefreshRef?.current;
        if (automatic && automatic.job.shouldApply()) {
            if (automatic.source !== 'stats_burnout') return;
            if (groupPreferences.onboardingRequired || !tasksFetched || !selectedSprintInfo?.name || !burnoutIssueKeys.length) { automatic.settle([{ source: 'stats_burnout', status: 'ignored', checkKind: 'unknown', coverage: 'unknown', requestStartedAtMs: 0 }]); return; }
            return runAutomaticStatsRead(automatic, 'stats_burnout', issueEditStateRef,
                signal => requestBurnoutStats(BACKEND_URL, { sprint: selectedSprintInfo.name, teamIds: burnoutScopedTeamIds,
                    issueKeys: burnoutIssueKeys, includePostSprintClosures: isCompletedSprintSelected }, { signal, suppressAbortResult: true }),
                data => { automaticBurnoutDataRef.current = data; burnoutCacheRef.current[burnoutQueryKey] = data; setBurnoutData(data); });
        }
        automaticBurnoutDataRef.current = null;
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
            const readToken = issueEditStateRef.current.beginRead({ aggregate: true }), started = Date.now(), recordExplicit = automaticRefreshRef?.createExplicitRecorder?.('stats_burnout'); setBurnoutLoading(true);
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
                recordExplicit?.(payload, started);
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
                recordExplicit?.retire(); issueEditStateRef.current.finishRead(readToken); window.clearTimeout(timeoutId);
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
        if (burnoutData && automaticBurnoutDataRef.current === burnoutData) return;
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
    scope, automaticRefreshRef, BACKEND_URL, EMPTY_ARRAY, EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY,
    activeGroup, activeGroupAdHocCapacityEpics, activeGroupMissingComponents, activeGroupTeamIds,
    adminSettingsGate, availableSprints, burnoutAssigneeFilter, burnoutQueryKey,
    burnoutScopedTeamIds, burnoutScopedTeamSignature, cohortCacheRef,
    cohortClosedEndQuarter, cohortClosedStartQuarter, cohortData, cohortEndQuarter, cohortExcludeAdHoc, cohortExcludeCapacity,
    cohortGroupBy, cohortLastN, cohortMode, cohortProjectFilter, cohortQueryKey, cohortScopedTeamSignature,
    cohortSelectedRow, cohortStartQuarter, cohortStatusToggles, excludedCapacityCacheRef,
    excludedCapacityChartMode, excludedCapacityData, excludedCapacityEndSprintId, excludedCapacityEpicDropdownOpen,
    excludedCapacityEpicDropdownRef, excludedCapacityForceRefreshRef, excludedCapacityIsolatedTeam, excludedCapacityRefreshNonce,
    excludedCapacitySelectedEpicKeys, excludedCapacityStartSprintId, groupPreferences, issueEditStateRef,
    issuePeopleStatsRevision, projectTrackCapacitySide, projectTrackExcludeAdHoc, projectTrackExcludeExcludedCapacity,
    projectTrackMode, projectTrackPhaseAbortRef, projectTrackPhaseCacheRef, projectTrackPhaseData,
    setBurnoutTaskFilter, setCohortData, setCohortError,
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
    const automaticCohortDataRef = React.useRef(null);
    const automaticExcludedDataRef = React.useRef(null);
    useEffect(() => {
        if (showStats && statsView === 'burnout') return;
        setBurnoutTaskFilter(null);
    }, [showStats, statsView]);

    useEffect(() => {
        if (automaticRefreshRef?.current?.job.shouldApply()) return;
        setBurnoutTaskFilter(null);
    }, [selectedSprintInfo?.name, burnoutAssigneeFilter, burnoutQueryKey]);

    useEffect(() => {
        if (!showStats || statsView !== 'cohort') return;
        const activeStartQuarter = cohortMode === 'closed' ? cohortClosedStartQuarter : cohortStartQuarter;
        const activeEndQuarter = cohortMode === 'closed' ? cohortClosedEndQuarter : cohortEndQuarter;
        const automatic = automaticRefreshRef?.current;
        if (automatic && automatic.job.shouldApply()) {
            if (automatic.source !== 'stats_cohort') return;
            if (groupPreferences.onboardingRequired || adminSettingsGate.status !== 'clear' || (cohortMode !== 'last_n' && (!activeStartQuarter || !activeEndQuarter))) { automatic.settle([{ source: 'stats_cohort', status: 'ignored', checkKind: 'unknown', coverage: 'unknown', requestStartedAtMs: 0 }]); return; }
            return runAutomaticStatsRead(automatic, 'stats_cohort', issueEditStateRef,
                signal => requestEpicCohortStats(BACKEND_URL, buildCohortRequest({ mode: cohortMode, startQuarter: activeStartQuarter, endQuarter: activeEndQuarter,
                    teamIds: burnoutScopedTeamIds, components: activeGroupMissingComponents, adHocCapacityEpics: activeGroupAdHocCapacityEpics }), { signal, suppressAbortResult: true }),
                data => { automaticCohortDataRef.current = data; cohortCacheRef.current[cohortQueryKey] = data; setCohortData(data); });
        }
        automaticCohortDataRef.current = null;
        if (groupPreferences.onboardingRequired || adminSettingsGate.status !== 'clear') { setCohortData(null); setCohortError(''); setCohortLoading(false); return; }
        const startQuarter = String(activeStartQuarter || '').trim();
        const endQuarter = String(activeEndQuarter || '').trim();
        if (cohortMode !== 'last_n' && (!startQuarter || !endQuarter)) {
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
            const readToken = issueEditStateRef.current.beginRead({ aggregate: true }), started = Date.now(), recordExplicit = automaticRefreshRef?.createExplicitRecorder?.('stats_cohort'); setCohortLoading(true);
            setCohortError('');
            try {
                const response = await requestEpicCohortStats(
                    BACKEND_URL,
                    buildCohortRequest({
                        mode: cohortMode,
                        startQuarter,
                        endQuarter,
                        teamIds: burnoutScopedTeamIds,
                        components: activeGroupMissingComponents,
                        adHocCapacityEpics: activeGroupAdHocCapacityEpics
                    }),
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
                recordExplicit?.(payload, started);
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
                recordExplicit?.retire(); issueEditStateRef.current.finishRead(readToken); window.clearTimeout(timeoutId);
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
    }, [showStats, statsView, cohortMode, cohortStartQuarter, cohortEndQuarter, cohortClosedStartQuarter, cohortClosedEndQuarter, cohortQueryKey, cohortScopedTeamSignature, burnoutScopedTeamSignature, activeGroupMissingComponents, adHocEpicSignature, groupPreferences.onboardingRequired, adminSettingsGate.status, issuePeopleStatsRevision]);

    const cohortQuarterOptions = React.useMemo(() => {
        return buildQuarterOptions(getCurrentQuarterLabel(), 16);
    }, []);
    // Cached or in-flight data from another mode must never render under the current one: it is "awaiting".
    const cohortAwaitingMode = cohortData != null && (cohortData.meta?.mode ?? 'created') !== cohortMode;
    const cohortModeData = cohortAwaitingMode ? null : cohortData;
    const cohortIssues = React.useMemo(() => {
        return Array.isArray(cohortModeData?.issues) ? cohortModeData.issues : [];
    }, [cohortModeData]);
    const cohortProjectOptions = React.useMemo(() => deriveProjectOptions(cohortIssues), [cohortIssues]);
    const cohortFilteredIssues = React.useMemo(() => {
        return filterCohortIssues(cohortIssues, {
            projectKey: cohortProjectFilter,
            excludeAdHoc: cohortExcludeAdHoc,
            excludeEpicKeys: cohortExcludeCapacity ? excludedEpicSet : EMPTY_ARRAY,
            statusToggles: cohortStatusToggles,
            closedOnly: cohortMode !== 'created'
        });
    }, [cohortIssues, cohortProjectFilter, cohortExcludeAdHoc, cohortExcludeCapacity, cohortStatusToggles, excludedEpicSet, cohortMode]);
    // Last N counts after the filters: the server sends one bounded window, the newest N that pass them are shown.
    const cohortDisplayedIssues = React.useMemo(() => {
        return cohortMode === 'last_n' ? selectLastClosedEpics(cohortFilteredIssues, cohortLastN) : cohortFilteredIssues;
    }, [cohortMode, cohortFilteredIssues, cohortLastN]);
    const cohortCreatedRange = React.useMemo(() => {
        return cohortMode === 'created' ? null : createdRangeOf(cohortDisplayedIssues);
    }, [cohortMode, cohortDisplayedIssues]);
    const cohortScope = cohortModeData?.meta?.scope ?? null;
    const cohortFetchedCount = cohortIssues.length;
    const cohortLastNShortfall = React.useMemo(() => {
        if (cohortMode !== 'last_n' || cohortModeData?.meta?.windowFull !== true) return null;
        const shown = cohortDisplayedIssues.length;
        if (shown >= cohortLastN) return null;
        return { shown, requested: cohortLastN, ceiling: cohortModeData.meta.windowCeiling ?? null };
    }, [cohortMode, cohortModeData, cohortDisplayedIssues, cohortLastN]);
    const cohortSummary = React.useMemo(() => aggregateCohortSummary(cohortDisplayedIssues), [cohortDisplayedIssues]);
    const cohortWorkflowStatusTotal = (cohortSummary.inProgress || 0) + (cohortSummary.postponed || 0) + (cohortSummary.awaitingValidation || 0);
    // Created rows follow the requested creation range; the closed modes span the displayed Epics themselves.
    const cohortRangeStartDate = cohortMode === 'created' ? cohortModeData?.range?.startDate : cohortCreatedRange?.startDate;
    const cohortRangeEndDate = cohortMode === 'created' ? cohortModeData?.range?.endDate : cohortCreatedRange?.endDate;
    const cohortGridModel = React.useMemo(() => buildCohortGridModel(cohortDisplayedIssues, {
        groupBy: cohortGroupBy,
        maxColumns: cohortGroupBy === 'month' ? 24 : 12,
        overflowColumn: cohortMode !== 'created',
        rangeStartDate: cohortRangeStartDate,
        rangeEndDate: cohortRangeEndDate
    }), [cohortDisplayedIssues, cohortGroupBy, cohortMode, cohortRangeStartDate, cohortRangeEndDate]);
    const cohortOpenBars = React.useMemo(() => buildOpenEpicsBars(cohortDisplayedIssues, {
        groupBy: cohortGroupBy,
        rowKey: cohortSelectedRow
    }), [cohortDisplayedIssues, cohortGroupBy, cohortSelectedRow]);
    const cohortCompletedBars = React.useMemo(() => buildCompletedEpicsBars(cohortDisplayedIssues, {
        groupBy: cohortGroupBy,
        rowKey: cohortSelectedRow
    }), [cohortDisplayedIssues, cohortGroupBy, cohortSelectedRow]);
    const cohortAverageLeadDays = React.useMemo(() => {
        const resolved = cohortDisplayedIssues.filter((issue) => {
            const statusKey = normalizeCohortStatus(issue?.status);
            if (statusKey === 'open') return false;
            return Number.isFinite(Number(issue?.leadTimeDays));
        });
        if (!resolved.length) return null;
        const total = resolved.reduce((sum, issue) => sum + Number(issue?.leadTimeDays || 0), 0);
        return total / resolved.length;
    }, [cohortDisplayedIssues]);
    const cohortMedianLeadDays = React.useMemo(() => {
        const values = cohortDisplayedIssues
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
    }, [cohortDisplayedIssues]);
    const cohortWarnings = React.useMemo(() => {
        const warnings = cohortModeData?.meta?.warnings;
        return Array.isArray(warnings) ? warnings : [];
    }, [cohortModeData]);
    const cohortStatusControls = React.useMemo(() => (cohortMode === 'created' ? [
        { key: 'done', label: 'Done' },
        { key: 'open', label: 'In Progress' },
        { key: 'killed', label: 'Killed' },
        { key: 'incomplete', label: 'Incomplete' },
        { key: 'postponed', label: 'Postponed' }
    ] : [
        { key: 'done', label: 'Done' },
        { key: 'killed', label: 'Killed' },
        { key: 'incomplete', label: 'Incomplete' }
    ]), [cohortMode]);
    const cohortSelectedRowLabel = React.useMemo(() => {
        if (!cohortSelectedRow) return '';
        const row = (cohortGridModel?.rows || []).find((item) => item.key === cohortSelectedRow);
        return row?.label || cohortSelectedRow;
    }, [cohortGridModel, cohortSelectedRow]);

    useEffect(() => {
        if (cohortData && automaticCohortDataRef.current === cohortData) return;
        if (cohortAwaitingMode) return;
        if (cohortProjectFilter === 'all') return;
        const exists = cohortProjectOptions.some((item) => item.value === cohortProjectFilter);
        if (!exists) setCohortProjectFilter('all');
    }, [cohortProjectFilter, cohortProjectOptions, cohortAwaitingMode]);

    useEffect(() => {
        if (cohortData && automaticCohortDataRef.current === cohortData) return;
        if (cohortAwaitingMode) return;
        if (!cohortSelectedRow) return;
        const exists = (cohortGridModel?.rows || []).some((row) => row.key === cohortSelectedRow);
        if (!exists) {
            setCohortSelectedRow(null);
        }
    }, [cohortGridModel, cohortSelectedRow, cohortAwaitingMode]);

    const excludedCapacitySprintOptions = React.useMemo(() => {
        return sortSprintsNewestFirst(availableSprints);
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
        const automatic = automaticRefreshRef?.current;
        if (automatic && automatic.job.shouldApply()) {
            if (automatic.source !== 'stats_excluded_capacity') return;
            if (groupPreferences.onboardingRequired || adminSettingsGate.status !== 'clear' || (statsView === 'excludedCapacity' && !excludedCapacityEpicOptions.length && adHocEpicSet.size === 0) || (activeGroupId && activeGroupTeamIds.length === 0)) { automatic.settle([{ source: 'stats_excluded_capacity', status: 'ignored', checkKind: 'unknown', coverage: 'unknown', requestStartedAtMs: 0 }]); return; }
            const sprintId = String(selectedSprint || '');
            if (!excludedCapacitySprintIds.includes(sprintId)) { automatic.settle([{ source: 'stats_excluded_capacity', status: 'denied', checkKind: 'unknown', coverage: 'unknown', requestStartedAtMs: 0 }]); return; } // Outside-range Sprint: deferred by policy; no read, no check, source settles quietly.
            const sprintKey = id => `sprint::${id}::${excludedCapacityScopedTeamSignature || 'all'}`;
            return runAutomaticStatsRead(automatic, 'stats_excluded_capacity', issueEditStateRef,
                signal => requestExcludedCapacityStatsSource(BACKEND_URL, { sprintIds: [sprintId], teamIds: excludedCapacityScopedTeamIds, refresh: true, signal }),
                chunk => {
                    const chunks = excludedCapacitySprintIds.map(id => id === sprintId ? chunk : excludedCapacityCacheRef.current[sprintKey(id)]);
                    // A missing untouched chunk is not permission to shrink the held chart.
                    if (chunks.some(value => !value) || !excludedCapacitySprintIds.includes(sprintId)) return false;
                    const data = mergeExcludedCapacityStatsSourceChunks(chunks, { loadedSprintCount: chunks.length, totalSprintCount: chunks.length });
                    automaticExcludedDataRef.current = { data, projectTrackMode, phaseFacets: JSON.stringify([projectTrackCapacitySide, projectTrackExcludeAdHoc, projectTrackExcludeExcludedCapacity]) };
                    excludedCapacityCacheRef.current[sprintKey(sprintId)] = chunk;
                    excludedCapacityCacheRef.current[`range::${excludedCapacityQueryKey}`] = data;
                    setExcludedCapacityData(data);
                });
        }
        automaticExcludedDataRef.current = null;
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
        const chunkKinds = [];
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
                chunkKinds.push(payload.cached);
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
            const started = Date.now(), recordExplicit = automaticRefreshRef?.createExplicitRecorder?.('stats_excluded_capacity');
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
                recordExplicit?.({ cached: chunkKinds.every(value => value === false) ? false : chunkKinds.some(value => value === true) ? true : undefined }, started, result.errors.length ? 'partial' : 'unknown');
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
                recordExplicit?.retire(); issueEditStateRef.current.finishRead(readToken); if (!cancelled) setExcludedCapacityLoading(false);
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
    const projectTrackSingleTeam = excludedCapacityScopedTeamIds.length === 1;
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
        if (automaticExcludedDataRef.current && (automaticExcludedDataRef.current.projectTrackMode !== projectTrackMode || automaticExcludedDataRef.current.phaseFacets !== JSON.stringify([projectTrackCapacitySide, projectTrackExcludeAdHoc, projectTrackExcludeExcludedCapacity]))) automaticExcludedDataRef.current = null;
        if (automaticRefreshRef?.current?.job.shouldApply() || (excludedCapacityData && automaticExcludedDataRef.current?.data === excludedCapacityData && automaticExcludedDataRef.current.projectTrackMode === projectTrackMode)) return;
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
        if (excludedCapacityData && automaticExcludedDataRef.current?.data === excludedCapacityData) return;
        if (excludedCapacitySelectedEpicKeys === null && excludedCapacityEpicOptions.length) {
            setExcludedCapacitySelectedEpicKeys(excludedCapacityEpicOptions.slice());
        }
    }, [excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]);
    useEffect(() => {
        if (excludedCapacityData && automaticExcludedDataRef.current?.data === excludedCapacityData) return;
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
        if (excludedCapacityData && automaticExcludedDataRef.current?.data === excludedCapacityData) return;
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
        cohortQuarterOptions, cohortProjectOptions, cohortSummary,
        cohortWorkflowStatusTotal, cohortGridModel, cohortOpenBars, cohortCompletedBars,
        cohortAverageLeadDays, cohortMedianLeadDays, cohortWarnings, cohortStatusControls,
        cohortSelectedRowLabel, cohortDisplayedIssues, cohortScope, cohortFetchedCount, cohortAwaitingMode, cohortLastNShortfall,
        excludedCapacitySprintOptions, excludedCapacitySprintRange, effortSplitSprintLabel,
        excludedCapacityEpicOptions, projectTrackSeries, projectTrackTotals, projectTrackBreakdown,
        projectTrackColumnSplit, projectTrackSingleTeam, projectTrackRangeLabel, projectTrackPhaseEpics, projectTrackPhaseSummary,
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
