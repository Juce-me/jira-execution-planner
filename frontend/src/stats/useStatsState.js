import { useRef, useState } from 'react';
import { getCurrentQuarterLabel } from '../cohort/cohortUtils.js';

export function useStatsState({ savedPrefsRef, resolveStatsView, resolveStatsGraphMode, resolveBurndownMetric, resolveCohortGroupBy }) {
    const [statsView, setStatsView] = useState(resolveStatsView(savedPrefsRef.current.statsView));
    const [statsGraphMode, setStatsGraphMode] = useState(resolveStatsGraphMode(savedPrefsRef.current.statsGraphMode));
    const [burnoutData, setBurnoutData] = useState(null);
    const [burnoutLoading, setBurnoutLoading] = useState(false);
    const [burnoutError, setBurnoutError] = useState('');
    const [burnoutAssigneeFilter, setBurnoutAssigneeFilter] = useState(savedPrefsRef.current.burnoutAssigneeFilter || 'all');
    const [burndownMetric, setBurndownMetric] = useState(resolveBurndownMetric(savedPrefsRef.current.burndownMetric));
    const [cohortData, setCohortData] = useState(null);
    const [cohortLoading, setCohortLoading] = useState(false);
    const [cohortError, setCohortError] = useState('');
    const [cohortStartQuarter, setCohortStartQuarter] = useState(savedPrefsRef.current.cohortStartQuarter || getCurrentQuarterLabel());
    const [cohortEndQuarter, setCohortEndQuarter] = useState(savedPrefsRef.current.cohortEndQuarter || getCurrentQuarterLabel());
    const [cohortGroupBy, setCohortGroupBy] = useState(resolveCohortGroupBy(savedPrefsRef.current.cohortGroupBy));
    const [cohortProjectFilter, setCohortProjectFilter] = useState(savedPrefsRef.current.cohortProjectFilter || 'all');
    const [cohortAssigneeFilter, setCohortAssigneeFilter] = useState(savedPrefsRef.current.cohortAssigneeFilter || 'all');
    const [cohortExcludeAdHoc, setCohortExcludeAdHoc] = useState(Boolean(savedPrefsRef.current.cohortExcludeAdHoc));
    const [cohortExcludeCapacity, setCohortExcludeCapacity] = useState(savedPrefsRef.current.cohortExcludeCapacity ?? true);
    const [cohortStatusToggles, setCohortStatusToggles] = useState(() => ({
        done: true,
        open: true,
        killed: false,
        incomplete: false,
        postponed: false,
        ...(savedPrefsRef.current.cohortStatusToggles || {})
    }));
    const [cohortSelectedRow, setCohortSelectedRow] = useState(null);
    const [excludedCapacityData, setExcludedCapacityData] = useState(null);
    const [excludedCapacityLoading, setExcludedCapacityLoading] = useState(false);
    const [excludedCapacityError, setExcludedCapacityError] = useState('');
    const [excludedCapacityStartSprintId, setExcludedCapacityStartSprintId] = useState(savedPrefsRef.current.excludedCapacityStartSprintId || '');
    const [excludedCapacityEndSprintId, setExcludedCapacityEndSprintId] = useState(savedPrefsRef.current.excludedCapacityEndSprintId || '');
    const [excludedCapacitySelectedEpicKeys, setExcludedCapacitySelectedEpicKeys] = useState(() => {
        const saved = savedPrefsRef.current.excludedCapacitySelectedEpicKeys;
        if (Array.isArray(saved)) {
            return saved.map(key => String(key || '').trim().toUpperCase()).filter(Boolean);
        }
        return null;
    });
    const [excludedCapacityChartMode, setExcludedCapacityChartMode] = useState(
        savedPrefsRef.current.excludedCapacityChartMode === 'group' ? 'group' : 'teams'
    );
    const [excludedCapacityMetric, setExcludedCapacityMetric] = useState(
        savedPrefsRef.current.excludedCapacityMetric === 'storyPoints' ? 'storyPoints' : 'percent'
    );
    const [effortSplitVisibleBuckets, setEffortSplitVisibleBuckets] = useState({
        excludedCapacity: true,
        adHoc: true,
        product: true,
        tech: true
    });
    const [excludedCapacityIsolatedTeam, setExcludedCapacityIsolatedTeam] = useState(null);
    const [excludedCapacityEpicDropdownOpen, setExcludedCapacityEpicDropdownOpen] = useState(false);
    const [excludedCapacityRefreshNonce, setExcludedCapacityRefreshNonce] = useState(0);
    const [issuePeopleStatsRevision, setIssuePeopleStatsRevision] = useState(0);
    const excludedCapacityEpicDropdownRef = useRef(null);
    const [projectTrackCapacitySide, setProjectTrackCapacitySide] = useState(
        ['product', 'tech', 'both'].includes(savedPrefsRef.current.projectTrackCapacitySide) ? savedPrefsRef.current.projectTrackCapacitySide : 'product'
    );
    const [projectTrackMode, setProjectTrackMode] = useState(
        savedPrefsRef.current.projectTrackMode === 'team' ? 'team' : 'epic'
    );
    const [projectTrackExcludeAdHoc, setProjectTrackExcludeAdHoc] = useState(Boolean(savedPrefsRef.current.projectTrackExcludeAdHoc));
    const [projectTrackExcludeExcludedCapacity, setProjectTrackExcludeExcludedCapacity] = useState(Boolean(savedPrefsRef.current.projectTrackExcludeExcludedCapacity));
    const [projectTrackPhaseData, setProjectTrackPhaseData] = useState(null);
    const [projectTrackPhaseLoading, setProjectTrackPhaseLoading] = useState(false);
    const [projectTrackPhaseError, setProjectTrackPhaseError] = useState('');
    const projectTrackPhaseCacheRef = useRef({});
    const projectTrackPhaseAbortRef = useRef(null);
    const [burnoutTaskFilter, setBurnoutTaskFilter] = useState(null);
    const burnoutCacheRef = useRef({});
    const cohortCacheRef = useRef({});
    const excludedCapacityCacheRef = useRef({});
    const excludedCapacityForceRefreshRef = useRef(false);

    return {
        statsView,
        setStatsView,
        statsGraphMode,
        setStatsGraphMode,
        burnoutData,
        setBurnoutData,
        burnoutLoading,
        setBurnoutLoading,
        burnoutError,
        setBurnoutError,
        burnoutAssigneeFilter,
        setBurnoutAssigneeFilter,
        burndownMetric,
        setBurndownMetric,
        cohortData,
        setCohortData,
        cohortLoading,
        setCohortLoading,
        cohortError,
        setCohortError,
        cohortStartQuarter,
        setCohortStartQuarter,
        cohortEndQuarter,
        setCohortEndQuarter,
        cohortGroupBy,
        setCohortGroupBy,
        cohortProjectFilter,
        setCohortProjectFilter,
        cohortAssigneeFilter,
        setCohortAssigneeFilter,
        cohortExcludeAdHoc,
        setCohortExcludeAdHoc,
        cohortExcludeCapacity,
        setCohortExcludeCapacity,
        cohortStatusToggles,
        setCohortStatusToggles,
        cohortSelectedRow,
        setCohortSelectedRow,
        excludedCapacityData,
        setExcludedCapacityData,
        excludedCapacityLoading,
        setExcludedCapacityLoading,
        excludedCapacityError,
        setExcludedCapacityError,
        excludedCapacityStartSprintId,
        setExcludedCapacityStartSprintId,
        excludedCapacityEndSprintId,
        setExcludedCapacityEndSprintId,
        excludedCapacitySelectedEpicKeys,
        setExcludedCapacitySelectedEpicKeys,
        excludedCapacityChartMode,
        setExcludedCapacityChartMode,
        excludedCapacityMetric,
        setExcludedCapacityMetric,
        effortSplitVisibleBuckets,
        setEffortSplitVisibleBuckets,
        excludedCapacityIsolatedTeam,
        setExcludedCapacityIsolatedTeam,
        excludedCapacityEpicDropdownOpen,
        setExcludedCapacityEpicDropdownOpen,
        excludedCapacityRefreshNonce,
        setExcludedCapacityRefreshNonce,
        issuePeopleStatsRevision,
        setIssuePeopleStatsRevision,
        excludedCapacityEpicDropdownRef,
        projectTrackCapacitySide,
        setProjectTrackCapacitySide,
        projectTrackMode,
        setProjectTrackMode,
        projectTrackExcludeAdHoc,
        setProjectTrackExcludeAdHoc,
        projectTrackExcludeExcludedCapacity,
        setProjectTrackExcludeExcludedCapacity,
        projectTrackPhaseData,
        setProjectTrackPhaseData,
        projectTrackPhaseLoading,
        setProjectTrackPhaseLoading,
        projectTrackPhaseError,
        setProjectTrackPhaseError,
        projectTrackPhaseCacheRef,
        projectTrackPhaseAbortRef,
        burnoutTaskFilter,
        setBurnoutTaskFilter,
        burnoutCacheRef,
        cohortCacheRef,
        excludedCapacityCacheRef,
        excludedCapacityForceRefreshRef,
    };
}
