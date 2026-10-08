import { getCurrentQuarterLabel } from '../cohort/cohortUtils.js';

export const STATS_GROUP_STATE_KEYS = [
    'statsView',
    'statsGraphMode',
    'burnoutData',
    'burnoutLoading',
    'burnoutError',
    'burnoutAssigneeFilter',
    'burndownMetric',
    'cohortData',
    'cohortLoading',
    'cohortError',
    'cohortStartQuarter',
    'cohortEndQuarter',
    'cohortGroupBy',
    'cohortProjectFilter',
    'cohortAssigneeFilter',
    'cohortExcludeAdHoc',
    'cohortExcludeCapacity',
    'cohortStatusToggles',
    'cohortSelectedRow',
];

export function buildDefaultStatsGroupState(savedPrefs, { resolveStatsView, resolveStatsGraphMode, resolveBurndownMetric, resolveCohortGroupBy }) {
    return {
        statsView: resolveStatsView(savedPrefs.statsView),
        statsGraphMode: resolveStatsGraphMode(savedPrefs.statsGraphMode),
        burnoutData: null,
        burnoutLoading: false,
        burnoutError: '',
        burnoutAssigneeFilter: savedPrefs.burnoutAssigneeFilter || 'all',
        burndownMetric: resolveBurndownMetric(savedPrefs.burndownMetric),
        cohortData: null,
        cohortLoading: false,
        cohortError: '',
        cohortStartQuarter: savedPrefs.cohortStartQuarter || getCurrentQuarterLabel(),
        cohortEndQuarter: savedPrefs.cohortEndQuarter || getCurrentQuarterLabel(),
        cohortGroupBy: resolveCohortGroupBy(savedPrefs.cohortGroupBy),
        cohortProjectFilter: savedPrefs.cohortProjectFilter || 'all',
        cohortAssigneeFilter: savedPrefs.cohortAssigneeFilter || 'all',
        cohortExcludeAdHoc: Boolean(savedPrefs.cohortExcludeAdHoc),
        cohortExcludeCapacity: savedPrefs.cohortExcludeCapacity ?? true,
        cohortStatusToggles: {
            done: true,
            open: true,
            killed: false,
            incomplete: false,
            postponed: false,
            ...(savedPrefs.cohortStatusToggles || {})
        },
        cohortSelectedRow: null,
    };
}

export function snapshotStatsGroupState(values) {
    const { statsView, statsGraphMode, burnoutData, burnoutLoading, burnoutError, burnoutAssigneeFilter, burndownMetric, cohortData, cohortLoading, cohortError, cohortStartQuarter, cohortEndQuarter, cohortGroupBy, cohortProjectFilter, cohortAssigneeFilter, cohortExcludeAdHoc, cohortExcludeCapacity, cohortStatusToggles, cohortSelectedRow } = values;
    return {
        statsView,
        statsGraphMode,
        burnoutData,
        burnoutLoading,
        burnoutError,
        burnoutAssigneeFilter,
        burndownMetric,
        cohortData,
        cohortLoading,
        cohortError,
        cohortStartQuarter,
        cohortEndQuarter,
        cohortGroupBy,
        cohortProjectFilter,
        cohortAssigneeFilter,
        cohortExcludeAdHoc,
        cohortExcludeCapacity,
        cohortStatusToggles,
        cohortSelectedRow,
    };
}

export function applyStatsGroupState(nextState, setters, { resolveStatsView, resolveStatsGraphMode, resolveBurndownMetric, resolveCohortGroupBy }) {
    setters.setStatsView(resolveStatsView(nextState.statsView));
    setters.setStatsGraphMode(resolveStatsGraphMode(nextState.statsGraphMode));
    setters.setBurnoutData(nextState.burnoutData || null);
    setters.setBurnoutLoading(false);
    setters.setBurnoutError(nextState.burnoutError || '');
    setters.setBurnoutAssigneeFilter(nextState.burnoutAssigneeFilter || 'all');
    setters.setBurndownMetric(resolveBurndownMetric(nextState.burndownMetric));
    setters.setCohortData(nextState.cohortData || null);
    setters.setCohortLoading(false);
    setters.setCohortError(nextState.cohortError || '');
    setters.setCohortStartQuarter(nextState.cohortStartQuarter || getCurrentQuarterLabel());
    setters.setCohortEndQuarter(nextState.cohortEndQuarter || getCurrentQuarterLabel());
    setters.setCohortGroupBy(resolveCohortGroupBy(nextState.cohortGroupBy));
    setters.setCohortProjectFilter(nextState.cohortProjectFilter || 'all');
    setters.setCohortAssigneeFilter(nextState.cohortAssigneeFilter || 'all');
    setters.setCohortExcludeAdHoc(Boolean(nextState.cohortExcludeAdHoc));
    setters.setCohortExcludeCapacity(nextState.cohortExcludeCapacity ?? true);
    setters.setCohortStatusToggles({
        done: true,
        open: true,
        killed: false,
        incomplete: false,
        postponed: false,
        ...(nextState.cohortStatusToggles || {})
    });
    setters.setCohortSelectedRow(nextState.cohortSelectedRow || null);
}

export function resetStatsTransientRefs(refs) {
    refs.burnoutCacheRef.current = {};
    refs.cohortCacheRef.current = {};
    refs.excludedCapacityCacheRef.current = {};
}
