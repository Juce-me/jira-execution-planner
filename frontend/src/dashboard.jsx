import { useScenarioPlanner } from './scenario/useScenarioPlanner.js';
import { useScenarioState } from './scenario/useScenarioState.js';
import { buildDefaultScenarioGroupState, applyScenarioGroupState, resetScenarioTransientRefs } from './scenario/scenarioGroupState.js';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/dashboard.css';
import { normalizeScenarioDraftOverrides } from './scenario/scenarioDraftOverrides.js';

import { ScenarioView } from './scenario/ScenarioView.jsx';

import CohortGrid from './cohort/CohortGrid.jsx';
import LeadTimesEpicCharts from './cohort/LeadTimesEpicCharts.jsx';
import LeadTimesWorkflowStatusCard from './cohort/LeadTimesWorkflowStatusCard.jsx';
import SegmentedControl from './ui/SegmentedControl.jsx';
import ControlField from './ui/ControlField.jsx';
import IconButton from './ui/IconButton.jsx';
import EmptyState from './ui/EmptyState.jsx';
import LoadingState from './ui/LoadingState.jsx';
import StatusPill from './ui/StatusPill.jsx';
import JiraExportButton from './components/JiraExportButton.jsx';
import ServerUnavailableBanner from './components/ServerUnavailableBanner.jsx';
import { createSprintCatalogController, createSprintCatalogState, getCookie, getCurrentQuarter, isActiveHomeTokenConnection, loadCachedSprintCatalog, loadUiPrefs, saveUiPrefs, setCookie, shouldReconcileSprintCatalogSource, sprintCatalogSourcesEqual, sprintCatalogValidationKey } from './dashboardRuntime.js';
import OnboardingTour, { isDashboardMobileViewport } from './onboarding/OnboardingTour.jsx';
import { isEngOnboardingModuleSurface } from './onboarding/onboardingModules.js';
import { deriveOnboardingEngReadiness, isOnboardingAvailable } from './onboarding/onboardingSteps.js';
import { useOnboardingController } from './onboarding/useOnboardingTour.js';
import AuthRequiredGate from './components/AuthRequiredGate.jsx';
import ConnectionRecoveryNotice from './components/ConnectionRecoveryNotice.jsx';
import { AUTH_REQUIRED_EVENT, AUTHENTICATION_REQUIRED_CODE, isAuthenticationRequiredError, readPendingAuthenticationRequired } from './api/authRequired.js';
import { completeAuthRecovery, getAuthRecoveryStores } from './api/authRecoveryCoordinator.js';
import { clearAuthResumeState, getAuthResumeStorage, readAuthResumeState, writeAuthResumeState } from './api/authResumeState.js';
import { connectionRecoveryPrincipalFromConfig } from './api/connectionRecoveryState.js';
import { buildConnectionRecoveryShellState, buildConnectionRecoverySnapshot, useConnectionRecovery } from './api/useConnectionRecovery.js';
import IssueCard, { IssueCardContext } from './issues/IssueCard.jsx';
import { buildDependencyFocusPayload, buildDependencyFocusWithScreenState, buildDependencyKeySignature, buildIssueByKey } from './issues/dependencyFocusUtils.js';
import { formatPriorityShort, getIssueStatusClassName, getIssueTeamLabel } from './issues/issueViewUtils.js';
import { useStorySubtasks } from './issues/useStorySubtasks.js';
import EngView from './eng/EngView.jsx';
import EngFilterControls from './eng/EngFilterControls.jsx';
import EngBoardView from './eng/EngBoardView.jsx';
import EngAlertsPanel from './eng/EngAlertsPanel.jsx';
import StoryRequirementCard from './eng/StoryRequirementCard.jsx';
import EngModeControl from './eng/EngModeControl.jsx';
import { resolveEngSprintSelectorState } from './eng/engSprintSelectorState.js';
import EpicHeaderValueReadout from './eng/EpicHeaderValueReadout.jsx';
import EpicRefreshButton from './ui/EpicRefreshButton.jsx';
import { useEpicRefresh } from './eng/useEpicRefresh.js';
import { mergeEpicStories } from './eng/epicRefreshPatch.js';
import { createDependencySkip } from './eng/epicRefreshDependencySkip.js';
import PlanningActionBar from './eng/PlanningActionBar.jsx';
import PlanningOverviewPanel from './eng/PlanningOverviewPanel.jsx';
import PlanningReviewTable, { PlanningReviewScopeDialog } from './eng/PlanningReviewTable.jsx';
import { buildPlanningReviewRows, planningReviewScopeCounts } from './eng/planningReviewTableModel.js';
import { usePlanningSprintReview } from './eng/usePlanningSprintReview.js';
import PlanningCapacityBar from './eng/PlanningCapacityBar.jsx';
import PlanningProjectSplitBar from './eng/PlanningProjectSplitBar.jsx';
import PlanningTeamCapacityCards from './eng/PlanningTeamCapacityCards.jsx';
import { ENG_TASK_LOAD_OUTCOME, useEngSprintData } from './eng/useEngSprintData.js';
import { useStoryReadiness } from './eng/useStoryReadiness.js';
import { buildStoryReadinessAlertModel, storyReadinessStatusMessage, useEngWorkHierarchy } from './eng/useEngWorkHierarchy.js';
import { strictEngBoardMutationProps, strictEngBoardViewProps, useStrictEngBoardOwner, useStrictEngBoardPresentation } from './eng/useStrictEngBoardIntegration.js';
import { useEngStatusTransitions } from './eng/useEngStatusTransitions.js';
import { useEngPriorityTransitions } from './eng/useEngPriorityTransitions.js';
import { useEngProjectTrackTransitions } from './eng/useEngProjectTrackTransitions.js';
import { useEngIssueFieldEdits } from './eng/useEngIssueFieldEdits.js';
import { applyLocalEpicDetailsFieldUpdate } from './eng/engIssueLocalUpdates.js';
import { createEngIssueEditState, patchEngIssueList, patchEngLoadedState } from './eng/engIssueEditState.js';
import { navigateToAlertStory } from './eng/alertStoryNavigation.js';
import { navigateToStoryRequirement } from './eng/alertEpicNavigation.js';
import { useEngAlertFilters } from './eng/useEngAlertFilters.js';
import { isStatusTransitionSurfaceEnabled, buildEngStatusTargets, resolveSubtaskParentStoryKeys } from './eng/engStatusTransitionUtils.js';
import { deriveActiveEngMode, useEngModeState } from './eng/engModeState.js';
import StatusTransitionMenu from './issues/StatusTransitionMenu.jsx';
import { StatusColourProvider } from './issues/StatusColourContext.jsx';
import PriorityTransitionMenu from './issues/PriorityTransitionMenu.jsx';
import ProjectTrackTransitionMenu from './issues/ProjectTrackTransitionMenu.jsx';
import IssuePersonEditor from './issues/IssuePersonEditor.jsx';
import IssueSummaryEditor from './issues/IssueSummaryEditor.jsx';
import IssueTeamEditor from './issues/IssueTeamEditor.jsx';
import StoryPointsEditor from './issues/StoryPointsEditor.jsx';
import { DEFAULT_ENG_STATUS_FILTER, buildEngCatchUpFacetModel, isEngClosedWorkStatus, migrateEngCatchUpFilters, readEngCatchUpFilterState, resolveEngCatchUpFilters } from './eng/engCatchUpFilters.js';
import { PRIORITY_ORDER, getEpicTeamInfo, getTaskTeamInfo, groupTasksByTeam, matchesEngTaskSearch, resetEngFacetFilters, resetEngFilters, getEpicEffectivePriority, getProjectTrackEmoji, getProjectTrackLabel, normalizeEngEpicSort, DEFAULT_ENG_EPIC_SORT, sortEpicGroups } from './eng/engTaskUtils.js';
import { createPlanningSelectionHandlers, persistPlanningSelectionState, resolvePlanningAuthResume, resolvePlanningSelectionForDashboard, selectedTaskKeysFromMap, selectedTaskMapFromKeys } from './eng/planningSelectionActions.js';
import {
    applyCapacitySaveResultForScope,
    beginCapacityReadOwnership,
    buildCapacityScopeSignature,
    buildCapacityTotals,
    buildCapacityTotalsSummary,
    buildDisplayedTeamOptions,
    buildExcludedCapacityByTeamId,
    buildProjectCapacity,
    buildSelectedProjectEntries,
    buildSelectedTeamEntries,
    buildTeamCapacityEntries,
    buildTeamCapacityStats,
    buildTeamSpTotals,
    getCapacityShareLabel,
    getCapacityStatus,
    getTeamCapacityMeta,
    normalizeCapacityKey,
    normalizeCapacityTeamName,
    reduceCapacityReadLifecycle,
    resolveUniqueCapacityValue,
} from './eng/planningCapacityUtils.js';
import { buildExcludedProjectStats, buildSelectedPlanningTasksList, buildSelectedProjectStats, buildSelectedTeamProjectStats, buildSelectedTeamStats, sumPlanningStoryPoints } from './eng/planningSelectionStats.js';
import { classifyCapacityIssue } from './capacityClassification.mjs';
import {
    aggregateCohortSummary,
    buildCohortGridModel,
    buildCompletedEpicsBars,
    buildOpenEpicsBars,
    buildQuarterOptions,
    compareQuarterLabels,
    deriveAssigneeOptions,
    deriveProjectOptions,
    filterCohortIssues,
    getCurrentQuarterLabel,
    normalizeCohortStatus
} from './cohort/cohortUtils.js';
import {
    buildDefaultExcludedCapacityRange,
    buildEpicTeamCrossShareLineSeries,
    buildEpicTeamModeOverall,
    buildEpicTeamModeSprintRows,
    buildEffortTypeSplitRows,
    buildExcludedCapacityLineSeries,
    buildExcludedCapacityTimeSeries,
    buildExcludedEpicCatalog,
    compareSprintsChronologically,
    getSprintRange,
    getSprintQuarterLabel,
    loadExcludedCapacityStatsSourceChunks,
    mergeExcludedCapacityStatsSourceChunks,
    summarizeEffortTypeSplitTotals
} from './stats/excludedCapacityStats.js';
import { PRIORITY_AXIS } from './stats/statsConstants.js';
import { buildPriorityWeightMap } from './stats/priorityWeights.js';
import { buildBurnoutChartModel } from './stats/burnoutChartUtils.js';
import {
    buildLocalStatsFromTasks,
    buildRadarPoints,
    buildTeamColorMap,
    computePriorityWeighted,
    computeRate,
    formatPercent,
    getPriorityLabel,
    getRateClass,
    resolveTeamColor,
    resolveProjectTrackColor,
} from './stats/statsUtils.js';
import StatsDeliverySummary from './stats/StatsDeliverySummary.jsx';
import StatsPriorityView from './stats/StatsPriorityView.jsx';
import StatsTeamsView from './stats/StatsTeamsView.jsx';
import BurnoutChart from './stats/BurnoutChart.jsx';
import ExcludedCapacityLineChart from './stats/ExcludedCapacityLineChart.jsx';
import EffortTypeSplitChart from './stats/EffortTypeSplitChart.jsx';
import ProjectTrackTotalsBar from './stats/ProjectTrackTotalsBar.jsx';
import ProjectTrackSprintChart from './stats/ProjectTrackSprintChart.jsx';
import ProjectTrackBreakdownChart from './stats/ProjectTrackBreakdownChart.jsx';
import ProjectTrackPhaseChart from './stats/ProjectTrackPhaseChart.jsx';
import StatsRangeControl from './stats/StatsRangeControl.jsx';
import { buildProjectTrackSprintSeries, summarizeProjectTrackTotals, buildProjectTrackBreakdownRows, buildProjectTrackColumnSplit, inScopeEpicKeys as projectTrackInScopeEpicKeys } from './stats/projectTrackStats.js';
import { summarizeTrackPhaseDurations } from './stats/projectTrackPhaseStats.js';
import { epicHasExplicitlyEmptySprintValue, epicHasSelectedSprintLabel, epicMatchesSelectedSprint, filterExplicitBacklogEpics, issueMatchesSelectedSprint } from './backlogAlertSprintUtils.mjs';
import { getNextExclusiveDropdownState } from './controlDropdownUtils.mjs';
import { getFuturePlanningNeedsStoriesReasonText } from './futurePlanningNeedsStories.mjs';
import { epicHasFuturePlanningTeamLabel, epicMatchesFuturePlanningTeamSelection, getFuturePlanningEpicTeamInfos } from './futurePlanningTeamUtils.mjs';
import {
    fetchMissingPlanningInfo as requestMissingPlanningInfo,
    fetchSprints as requestSprints,
    fetchDependencies as requestDependencies,
    fetchExcludedCapacityStatsSource as requestExcludedCapacityStatsSource,
} from './api/engApi.js';
import { fetchCapacity as requestCapacity, updateCapacity } from './api/capacityApi.js';
import { resolveBackendUrl } from './api/backendUrl.js';
import {
    fetchBootstrapConfig,
    fetchVersionInfo,
    completeOnboardingModule as requestCompleteOnboardingModule,
    resetOnboardingModules as requestResetOnboardingModules,
} from './api/configApi.js';
import FirstRunConfigurationContainer from './settings/FirstRunConfigurationContainer.jsx';
import { useSharedConfigSave, useSharedConfigSaveState } from './settings/useSharedConfigSave.js';
import {
    useSettingsAutoOpenEffect,
    useSettingsHotkeyEffect,
    useSettingsModal,
    useSettingsModalState,
    useSettingsTabGuardEffects,
} from './settings/useSettingsModalState.js';
import UnconfiguredWorkspaceNotice from './settings/UnconfiguredWorkspaceNotice.jsx';
import { firstMissingAdminSettingsTab, resolveAdminSettingsGate, useAdminSettingsGate } from './settings/adminSettingsGate.js';
import { buildPendingFirstRunGroupPreferencesDraft } from './settings/firstRunGroupConfiguration.js';
import { useFirstRunConfiguration, useFirstRunConfigurationState } from './settings/useFirstRunConfiguration.js';
import {
    normalizeGroupsConfig,
    normalizeTeamLabelAliases,
    resolveInitialGroupId
} from './settings/groupConfigUtils.js';
import { saveSharedExcludedCapacityToggle } from './settings/sharedExcludedCapacityToggle.js';
import {
    useTeamGroupLabelEffects,
    useTeamGroupSearchEffects,
    useTeamGroupSelectionEffect,
    useTeamGroupSettings,
} from './settings/useTeamGroupSettings.js';
import useTeamCatalogLifecycle from './settings/useTeamCatalogLifecycle.js';
import { buildSharedGroupsPayload } from './settings/groupVisibilityUtils.js';
import { ADMIN_SETTINGS_TAB_IDS, DEPARTMENT_SETTINGS_TAB_IDS } from './settings/settingsTabIds.js';

import { fetchBurnoutStats as requestBurnoutStats, fetchEpicCohortStats as requestEpicCohortStats, fetchProjectTrackPhaseDurations as requestProjectTrackPhaseDurations } from './api/statsApi.js';
import { fetchIssuesLookup as requestIssuesLookup } from './api/issuesApi.js';
import { EpmControls } from './epm/EpmControls.jsx';
import EpmProjectCollapseAllButton from './epm/EpmProjectCollapseAllButton.jsx';
import { EpmView } from './epm/EpmView.jsx';
import EpmSettingsTab from './epm/EpmSettingsTab.jsx';
import SettingsModalContainer from './settings/SettingsModalContainer.jsx';
import DepartmentsSettingsTab from './settings/DepartmentsSettingsTab.jsx';
import { createSettingsDraftReadGuard, useSettingsConfigBaselineRevision } from './settings/settingsConfigReadState.js';
import { useSettingsPermissions } from './settings/useSettingsPermissions.js';
import AdminSettingsContainer from './settings/AdminSettingsContainer.jsx';
import { createEmptyEpmConfigDraft } from './settings/epmConfigDraft.js';
import { createPerformanceGate } from './eng/loadPerformance.js';
import { useJiraFieldPickers } from './settings/useJiraFieldPickers.js';
import { usePriorityWeightsSettings } from './settings/usePriorityWeightsSettings.js';
import { useJiraProjectCatalogEffects, useJiraProjectSearchEffects, useJiraProjectSettings } from './settings/useJiraProjectSettings.js';
import { useCapacityMappingEffects, useCapacityMappingSettings } from './settings/useCapacityMappingSettings.js';
import {
    useEpmLabelMenuEffects,
    useEpmSavedSubGoalsEffect,
    useEpmSettings,
    useEpmSettingsLoadEffect,
    useEpmSettingsProjectsEffects,
} from './settings/useEpmSettings.js';
import UserConnectionsSettings from './settings/UserConnectionsSettings.jsx';
import { fetchHomeTokenConnection } from './api/authApi.js';
import { AUTH_LONG_ABSENCE_EVENT } from './api/authRefreshContract.js';
import { analyticsToken, buildPlanningReviewAnalyticsParams, bucketCount, exposeAnalyticsForTests, useDashboardAnalytics } from './analytics/dashboardAnalytics.js';
import { useEpmViewData } from './epm/useEpmViewData.js';
import {
    DEFAULT_EPM_PROJECT_SORT,
    flattenEpmRollupBoardsForDependencies,
    getEpmProjectDisplayName,
    isEpmProjectsConfigReady,
    normalizeEpmProjectSort,
    shouldUseEpmSprint
} from './epm/epmProjectUtils.mjs';
import {
    PLANNING_SELECTION_MODE_DEFAULT_ALL,
    PLANNING_SELECTION_MODE_MANUAL,
    buildPlanningScopeKey,
    hasPlanningState,
    loadPlanningState,
    resolvePlanningTeamSelection
} from './planningSelectionState.mjs';
import { buildTeamSelectionScopeKey, loadTeamSelectionState, reconcileTeamSelectionState, resolveTeamSelectionHydrationState, saveTeamSelectionState } from './teamSelectionPersistence.mjs';
import {
    buildTeamOptionsForScope,
    sanitizeSelectedTeamsForScope,
    selectedTeamSelectionsEqual
} from './teamSelectionUtils.mjs';
import { collectJiraExportKeysFromEpmRollupBoards, collectJiraExportKeysFromTasks, normalizeJiraExportKeys, openJiraIssueSearch } from './jiraExportUtils.mjs';

        const { useState, useEffect, useRef } = React;
        const EMPTY_ARRAY = Object.freeze([]);
        exposeAnalyticsForTests();
        const EMPTY_OBJECT = Object.freeze({});
        const EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY = 3;
        const stableAcceptedConfigValue = (value) => {
            if (Array.isArray(value)) return value.map(stableAcceptedConfigValue);
            if (!value || typeof value !== 'object') return value;
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableAcceptedConfigValue(value[key])]));
        };

        // Backend server URL
        const BACKEND_URL = resolveBackendUrl(window);

        function InitiativeIcon({ className = '', size = 14, title = 'INITIATIVE' }) {
            const classes = ['initiative-icon', className].filter(Boolean).join(' ');

            return (
                <span className={classes} aria-hidden="true" title={title || undefined}>
                    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
                        <path
                            d="M8 1.75c-2.35 0-4.25 1.91-4.25 4.25 0 1.51.79 2.89 2.08 3.66.39.23.67.66.67 1.14v.45c0 .41.34.75.75.75h1.5c.41 0 .75-.34.75-.75v-.45c0-.48.28-.91.67-1.14A4.25 4.25 0 0 0 12.25 6c0-2.34-1.9-4.25-4.25-4.25Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <path
                            d="M6.9 12.7h2.2"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                        <path
                            d="M7.2 14.25h1.6"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                </span>
            );
        }

        function App() {
            const savedPrefsRef = useRef(loadUiPrefs() || {}), sprintCatalogCacheRef = useRef(loadCachedSprintCatalog(savedPrefsRef.current));
            const sprintCatalogInitialStateRef = useRef(createSprintCatalogState({
                displaySnapshot: sprintCatalogCacheRef.current.cachedAt ? sprintCatalogCacheRef.current : null,
                savedSprintId: savedPrefsRef.current.selectedSprint ?? null,
                savedSprintName: savedPrefsRef.current.sprintName || '',
            }));
            const perfEnabled = React.useMemo(
                () => new URLSearchParams(window.location.search).has('perf'),
                []
            );
            const perfCountersRef = useRef({
                renders: 0,
                edgeRequests: 0,
                edgeFrames: 0,
                edgeComputes: 0,
                layoutReads: 0,
                scrollReads: 0,
                laneStacking: 0,
                statsBuild: 0
            });
            const perfLastRef = useRef({ ...perfCountersRef.current });
            const perfStateRef = useRef(null);
            const perfStateCountsRef = useRef({});
            const perfStateLastRef = useRef({});
            if (perfEnabled) {
                perfCountersRef.current.renders += 1;
            }
            const [productTasks, setProductTasks] = useState([]);
            const [techTasks, setTechTasks] = useState([]);
            const [loadedProductTasks, setLoadedProductTasks] = useState([]);
            const [loadedTechTasks, setLoadedTechTasks] = useState([]);
            const [tasksFetched, setTasksFetched] = useState(false);
            const [productTasksLoading, setProductTasksLoading] = useState(false);
            const [techTasksLoading, setTechTasksLoading] = useState(false);
            const [readyToCloseProductTasks, setReadyToCloseProductTasks] = useState([]);
            const [readyToCloseTechTasks, setReadyToCloseTechTasks] = useState([]);
            const [missingPlanningInfoTasks, setMissingPlanningInfoTasks] = useState([]);
            const [productEpicsInScope, setProductEpicsInScope] = useState([]);
            const [techEpicsInScope, setTechEpicsInScope] = useState([]);
            const [readyToCloseProductEpicsInScope, setReadyToCloseProductEpicsInScope] = useState([]);
            const [readyToCloseTechEpicsInScope, setReadyToCloseTechEpicsInScope] = useState([]);
            const [alertScopeTooLargeKey, setAlertScopeTooLargeKey] = useState('');
            const [techLoaded, setTechLoaded] = useState(false);
            const [loading, setLoading] = useState(false);
            const [error, setError] = useState('');
            const [sprintError, setSprintError] = useState('');
            const [serverConnectionError, setServerConnectionError] = useState('');
            const authResumePrincipalRef = useRef(null);
            const connectionRecoveryPrincipalRef = useRef(null);
            const connectionRecoverySnapshotRef = useRef(null);
            const {
                blocksManualRefresh: connectionRecoveryBlocksRefresh,
                clearServerConnectionError,
                consume: consumeConnectionRecovery,
                discardRecovery: discardConnectionRecovery,
                markBootstrapHealthy: markConnectionBootstrapHealthy,
                notice: connectionRecoveryNotice,
                pendingRef: pendingConnectionRecoveryRef,
                recover: recoverServerConnection,
                releaseOwnership: releaseConnectionRecoveryOwnership,
                reportServerConnectionError,
                scenarioStartedRef: connectionRecoveryScenarioStartedRef,
                setNotice: setConnectionRecoveryNotice,
                setStagedRevision: setConnectionRecoveryStagedRevision,
                setStatus: setConnectionRecoveryStatus,
                stagedRevision: connectionRecoveryStagedRevision,
                status: connectionRecoveryStatus,
            } = useConnectionRecovery({
                backendUrl: BACKEND_URL,
                principalRef: connectionRecoveryPrincipalRef,
                snapshotRef: connectionRecoverySnapshotRef,
                setServerConnectionError,
            });
            // The Status and Priority facets replaced the single statusFilter plus the Done and
            // Killed Display toggles; a payload saved before that still has to land somewhere
            // sensible, so the old keys are read once through the §7.4 mapping table.
            const initialEngFilters = savedPrefsRef.current.engStatusFilter !== undefined
                    || savedPrefsRef.current.engPriorityFilter !== undefined
                ? {
                    status: savedPrefsRef.current.engStatusFilter ?? null,
                    priority: savedPrefsRef.current.engPriorityFilter ?? null
                }
                : migrateEngCatchUpFilters(savedPrefsRef.current);
            const [engStatusFilter, setEngStatusFilter] = useState(initialEngFilters.status); const [engPriorityFilter, setEngPriorityFilter] = useState(initialEngFilters.priority); const [engProjectTrackFilter, setEngProjectTrackFilter] = useState(undefined);
            const [showTech, setShowTech] = useState(savedPrefsRef.current.showTech ?? true);
            const [showProduct, setShowProduct] = useState(savedPrefsRef.current.showProduct ?? true);
            const savedInitialViewRef = useRef(savedPrefsRef.current.selectedView ?? 'eng');
            const restoredInitialEpmViewRef = useRef(false);
            const [selectedView, setSelectedView] = useState(savedInitialViewRef.current === 'epm' ? 'eng' : savedInitialViewRef.current);
            const [homeTokenConnection, setHomeTokenConnection] = useState({ connected: false });
            const [homeTokenConnectionLoaded, setHomeTokenConnectionLoaded] = useState(false);
            const [authMode, setAuthMode] = useState('');
            const scenarioState = useScenarioState({ initialLaneMode: savedPrefsRef.current.scenarioLaneMode ?? 'team' });
            const {
                setScenarioLoading,
                setScenarioError,
                setScenarioData,
                scenarioLaneMode,
                setScenarioLaneMode,
                scenarioTimelineRef,
                setScenarioLayout,
                setScenarioCollapsedLanes,
                setScenarioHoverKey,
                setScenarioFlashKey,
                setScenarioScrollTop,
                setScenarioScrollLeft,
                setScenarioViewportHeight,
                setScenarioEpicFocus,
                setScenarioRangeOverride,
                scenarioFocusRestoreRef,
                scenarioSkipAutoCollapseRef,
                scenarioTeamCollapseInitRef,
                scenarioOverrides,
                scenarioDraftMeta,
                scenarioEditMode,
                scenarioEdgeUpdatePendingRef,
                scenarioEdgeFrameRef,
                scenarioScrollFrameRef,
                scenarioResizeFrameRef,
                scenarioPendingScrollRef,
                setScenarioTooltip,
                scenarioTooltipAnchorRef,
                scenarioIssueRefMap,
                setScenarioEdgeRender,
                scenarioRefreshNonceRef,
                scenarioGroupValues,
            } = scenarioState;
            const hasActiveHomeTokenConnection = React.useMemo(
                () => isActiveHomeTokenConnection(homeTokenConnection),
                [homeTokenConnection]
            );
            const showEpmNavigation = authMode === 'basic' || hasActiveHomeTokenConnection;
            const [sprintName, setSprintName] = useState(savedPrefsRef.current.sprintName || '');
            const selectedSprintRef = useRef(null);
            const planningReviewGuardRef = useRef(null);
            const planningReviewBrowserContextRef = useRef('');
            const [selectedSprint, setSelectedSprint] = useState(null);
            selectedSprintRef.current = selectedSprint; // Server-validated Sprint ID
            const [epmProjectSearch, setEpmProjectSearch] = useState('');
            const [epmProjectSort, setEpmProjectSort] = useState(normalizeEpmProjectSort(savedPrefsRef.current.epmProjectSort || DEFAULT_EPM_PROJECT_SORT));
            const [engEpicSort, setEngEpicSort] = useState(
                normalizeEngEpicSort(savedPrefsRef.current.engEpicSort || DEFAULT_ENG_EPIC_SORT)
            );
            const handleEngEpicSortChange = (value) => {
                setEngEpicSort(value);
                trackSortChanged('eng_epics', value, { feature_name: 'eng', source_surface: 'eng' });
            };
            const [showEpmProjectDropdown, setShowEpmProjectDropdown] = useState(false);
            const epmProjectDropdownRefs = useRef({ main: null, compact: null });
            const [showEpmSubGoalFilterDropdown, setShowEpmSubGoalFilterDropdown] = useState(false);
            const epmSubGoalFilterDropdownRefs = useRef({ main: null, compact: null });
            const [showEpmSortDropdown, setShowEpmSortDropdown] = useState(false);
            const epmSortDropdownRefs = useRef({ main: null, compact: null });
            const {
                adminSettingsTab,
                departmentSettingsTab,
                groupManageButtonRef,
                groupManageTab,
                groupTestMessage,
                groupTesting,
                setAdminSettingsTab,
                setDepartmentSettingsTab,
                setGroupManageTab,
                setGroupTestMessage,
                setGroupTesting,
                setShowGroupDiscardConfirm,
                setShowGroupListMobile,
                setShowGroupManage,
                showGroupDiscardConfirm,
                showGroupListMobile,
                showGroupManage,
            } = useSettingsModalState();
            const [sprintCatalogState, setSprintCatalogState] = useState(sprintCatalogInitialStateRef.current);
            const sprintCatalogControllerRef = useRef(null);
            const sprintCatalogPersistedValidationRef = useRef('');
            if (!sprintCatalogControllerRef.current) {
                sprintCatalogControllerRef.current = createSprintCatalogController({
                    initialState: sprintCatalogInitialStateRef.current,
                    read: async ({ forceRefresh, completionAttemptId, catalogIdentity, signal }) => {
                        const response = await requestSprints(BACKEND_URL, {
                            forceRefresh,
                            completionAttemptId,
                            catalogIdentity,
                            signal,
                        }).catch(err => {
                            reportServerConnectionError(err);
                            throw err;
                        });
                        markConnectionBootstrapHealthy('sprints');
                        // An abort that lands mid-body is a timed-out read, not an empty catalog.
                        const body = await response.json().catch(error => { if (signal?.aborted) throw error; return {}; });
                        return { httpStatus: response.status, ...body };
                    },
                    onState: nextState => {
                        setSprintCatalogState(nextState);
                        const applyCatalogSelection = () => {
                            const current = sprintCatalogControllerRef.current.getState();
                            if (current.authority === 'auth_locked') return;
                            const sprints = current.authority === 'validated' ? current.validatedSnapshot?.sprints || [] : [];
                            const selected = sprints.find(sprint => String(sprint.id) === String(selectedSprintRef.current))
                                || sprints.find(sprint => String(sprint.id) === String(current.selectedSprintId));
                            setSelectedSprint(selected?.id ?? null);
                            if (selected) setSprintName(selected.name);
                        };
                        const snapshot = nextState.validatedSnapshot;
                        if (nextState.authority === 'validated' && snapshot) {
                            const selected = snapshot.sprints.find(sprint => String(sprint.id) === String(selectedSprintRef.current))
                                || snapshot.sprints.find(sprint => String(sprint.id) === String(nextState.selectedSprintId));
                            const nextId = selected?.id ?? null;
                            if (String(selectedSprintRef.current) !== String(nextId) && planningReviewGuardRef.current) void planningReviewGuardRef.current(applyCatalogSelection);
                            else applyCatalogSelection();
                            const validationKey = sprintCatalogValidationKey(snapshot);
                            if (validationKey && validationKey !== sprintCatalogPersistedValidationRef.current) {
                                sprintCatalogPersistedValidationRef.current = validationKey;
                                sprintCatalogCacheRef.current = {
                                    version: 2,
                                    identity: snapshot.identity,
                                    cachedAt: Date.now(),
                                    validatedAt: snapshot.validatedAt,
                                    catalogVersion: snapshot.catalogVersion,
                                    sprints: snapshot.sprints,
                                };
                                savedPrefsRef.current = { ...(loadUiPrefs() || {}), sprintCatalog: sprintCatalogCacheRef.current };
                                saveUiPrefs(savedPrefsRef.current);
                            }
                        } else if (nextState.authority !== 'auth_locked') {
                            if (selectedSprintRef.current !== null && planningReviewGuardRef.current) void planningReviewGuardRef.current(applyCatalogSelection);
                            else applyCatalogSelection();
                        }
                        if (nextState.errorReason === 'sprint_board_required') {
                            setSprintError('Choose a Jira source Board in Settings.');
                        } else if (nextState.errorReason === 'catalog_identity_changed') {
                            setSprintError('Sprint catalog is unavailable. Retry.');
                        } else if (nextState.status === 'exhausted') {
                            setSprintError('Sprint refresh is taking longer than expected. Retry.');
                        } else if (nextState.status === 'error') {
                            setSprintError(nextState.validatedSnapshot
                                ? 'Sprint refresh failed. Retry.'
                                : 'Sprint catalog is unavailable. Retry.');
                        } else {
                            setSprintError('');
                        }
                    },
                });
            }
            const availableSprints = sprintCatalogState.availableSprints;
            const sprintsLoading = sprintCatalogState.status === 'loading'
                || (sprintCatalogState.status === 'unknown' && sprintCatalogState.authority !== 'validated');
            const [boardView, setBoardView] = useState(null);
            // Session-scoped, separate from Catch Up's engStatusFilter/engPriorityFilter (D19).
            const [engBoardFilterSelection, setEngBoardFilterSelection] = useState({});
            const [activeGroupId, setActiveGroupId] = useState(savedPrefsRef.current.activeGroupId ?? null);
            const [showGroupDropdown, setShowGroupDropdown] = useState(false);
            const [groupDropdownQuery, setGroupDropdownQuery] = useState('');
            const groupDropdownRefs = useRef({ main: null, compact: null });
            const [groupDraftError, setGroupDraftError] = useState('');
            const [settingsSaveError, setSettingsSaveError] = useState('');
            const {
                dispatchFirstRunConfigurationSession,
                firstRunConfigurationActive,
                firstRunConfigurationSession,
                firstRunConfigurationTargetGroupId,
                firstRunSetupChoice,
                pendingFirstRunConfigurationRef,
                pendingFirstRunGroupPreferencesRef,
                setFirstRunConfigurationTargetGroupId,
                setFirstRunSetupChoice,
            } = useFirstRunConfigurationState();
            const {
                acceptedBoardConfigRef,
                boardConfigReadGenerationRef,
                boardConfigSaveReadFenceRef,
                commitSharedConfigRevision,
                setSharedConfigReady,
                setSharedConfigRevision,
                setWorkspaceConfigConflict,
                settingsDraftSnapshotRef,
                sharedConfigReady,
                sharedConfigRevision,
                sharedConfigRevisionRef,
                workspaceConfigConflict,
            } = useSharedConfigSaveState();
            const [groupSaving, setGroupSaving] = useState(false);
            const [showTechnicalFieldIds, setShowTechnicalFieldIds] = useState(false);
            const [mappingHoverKey, setMappingHoverKey] = useState(null);
            const {
                adminAccess,
                adminAccessAvailable,
                adminUserManagementAvailable,
                applyBootstrapPermissions,
                applySavePermissions,
                canEditEpmConfiguration,
                canEditSharedConfiguration,
                performanceAdminAvailable,
                preferredSettingsTab,
                setPerformanceAdminAvailable,
                userCanEditSettings,
            } = useSettingsPermissions({
                BACKEND_URL,
                groupManageTab,
                showGroupManage,
            });
            const performanceGate = React.useMemo(createPerformanceGate, []);
            const activePerformanceLoadRef = useRef(null);
            const [performanceLoadRevision, setPerformanceLoadRevision] = useState(0);
            const [adminSettingsGate, applyAdminSettingsGateConfig, setAdminSettingsGate] = useAdminSettingsGate({ canEditSettings: canEditSharedConfiguration, openSettings: tab => openGroupManage(tab) });
            const {
                baselineRevision: settingsConfigBaselineRevision,
                acceptBaseline: acceptSettingsConfigBaseline,
            } = useSettingsConfigBaselineRevision();
            const {
                priorityWeightsDraft,
                setPriorityWeightsDraft,
                priorityWeightsSource,
                effectivePriorityWeightsRows,
                isPriorityWeightsDirty,
                priorityWeightsValidationError,
                priorityWeightsSum,
                loadPriorityWeightsConfig,
                savePriorityWeightsConfig,
                updatePriorityWeightDraft,
                resetPriorityWeightsDraft,
                applyLoaded: applyPriorityWeightsLoaded,
                draftSnapshot: priorityWeightsDraftSnapshot,
            } = usePriorityWeightsSettings({
                BACKEND_URL,
                acceptSettingsConfigBaseline,
                clearServerConnectionError,
                commitSharedConfigRevision,
                reportServerConnectionError,
                settingsConfigBaselineRevision,
                settingsDraftSnapshotRef,
                sharedConfigRevisionRef,
            });
            const {
                jiraProjects,
                loadingProjects,
                projectSearchQuery,
                setProjectSearchQuery,
                setProjectSearchRemoteResults,
                projectSearchRemoteLoading,
                setProjectSearchRemoteLoading,
                projectSearchOpen,
                setProjectSearchOpen,
                projectSearchIndex,
                setProjectSearchIndex,
                selectedProjectsDraft,
                setSelectedProjectsDraft,
                savedSelectedProjects,
                projectSearchInputRef,
                setBoardSearchRemoteResults,
                boardSearchRemoteLoading,
                setBoardSearchRemoteLoading,
                boardIdDraft,
                setBoardIdDraft,
                savedBoardId,
                boardNameDraft,
                setBoardNameDraft,
                boardSearchQuery,
                setBoardSearchQuery,
                boardSearchOpen,
                setBoardSearchOpen,
                boardSearchIndex,
                setBoardSearchIndex,
                boardSearchInputRef,
                jiraFields,
                loadingFields,
                issueTypesDraft,
                setIssueTypesDraft,
                issueTypeSearchQuery,
                setIssueTypeSearchQuery,
                issueTypeSearchOpen,
                setIssueTypeSearchOpen,
                issueTypeSearchIndex,
                setIssueTypeSearchIndex,
                issueTypeSearchInputRef,
                isProjectsDraftDirty,
                isBoardConfigDirty,
                isIssueTypesDraftDirty,
                boardSearchResults,
                projectSearchResults,
                issueTypeSearchResults,
                fetchJiraProjects,
                loadSelectedProjects,
                loadBoardConfig,
                saveBoardConfig,
                addProjectSelection,
                clearBoardSelection,
                removeProjectSelection,
                handleProjectSearchKeyDown,
                handleBoardSearchKeyDown,
                resolveProjectName,
                saveProjectSelection,
                loadIssueTypesConfig,
                saveIssueTypesConfig,
                fetchAvailableIssueTypes,
                addIssueType,
                removeIssueType,
                handleIssueTypeSearchKeyDown,
                fetchJiraFields,
                applyProjectsAndBoardLoaded: applyJiraProjectsAndBoardLoaded,
                applyIssueTypesLoaded: applyJiraIssueTypesLoaded,
                draftSnapshot: jiraProjectsDraftSnapshot,
            } = useJiraProjectSettings({
                BACKEND_URL,
                acceptSettingsConfigBaseline,
                boardConfigReadGenerationRef,
                boardConfigSaveReadFenceRef,
                clearServerConnectionError,
                commitSharedConfigRevision,
                reportServerConnectionError,
                setGroupDraftError,
                setGroupSaving,
                settingsConfigBaselineRevision,
                settingsDraftSnapshotRef,
                sharedConfigRevisionRef,
            });
            const [missingInfoEpics, setMissingInfoEpics] = useState([]);
            const [backlogProductEpics, setBacklogProductEpics] = useState([]);
            const [backlogTechEpics, setBacklogTechEpics] = useState([]);
            const techProjectKeys = React.useMemo(() => {
                const keys = new Set();
                for (const p of savedSelectedProjects) {
                    if (p.type === 'tech') keys.add(String(p.key).trim().toUpperCase());
                }
                // Fallback: if no config, use TECH prefix heuristic
                if (keys.size === 0) keys.add('TECH');
                return keys;
            }, [savedSelectedProjects]);
            const {
                capacityProjectDraft,
                setCapacityProjectDraft,
                capacityFieldIdDraft,
                setCapacityFieldIdDraft,
                capacityFieldNameDraft,
                setCapacityFieldNameDraft,
                capacityProjectSearchQuery,
                setCapacityProjectSearchQuery,
                capacityProjectSearchOpen,
                setCapacityProjectSearchOpen,
                capacityProjectSearchIndex,
                setCapacityProjectSearchIndex,
                capacityProjectSearchInputRef,
                capacityFieldSearchQuery,
                setCapacityFieldSearchQuery,
                capacityFieldSearchOpen,
                setCapacityFieldSearchOpen,
                capacityFieldSearchIndex,
                setCapacityFieldSearchIndex,
                capacityFieldSearchInputRef,
                isCapacityDraftDirty,
                loadCapacityConfig,
                saveCapacityConfig,
                resolveCapacityProjectName,
                capacityProjectSearchResults,
                handleCapacityProjectSearchKeyDown,
                capacityFieldSearchResults,
                capacityFieldSearchHidden,
                handleCapacityFieldSearchKeyDown,
                applyLoaded: applyCapacityLoaded,
                draftSnapshot: capacityDraftSnapshot,
            } = useCapacityMappingSettings({
                BACKEND_URL,
                acceptSettingsConfigBaseline,
                authMode,
                commitSharedConfigRevision,
                jiraFields,
                jiraProjects,
                settingsConfigBaselineRevision,
                settingsDraftSnapshotRef,
                sharedConfigRevisionRef,
            });
            const {
                sprintFieldIdDraft, setSprintFieldIdDraft, sprintFieldNameDraft, setSprintFieldNameDraft,
                sprintFieldSearchQuery, setSprintFieldSearchQuery, sprintFieldSearchOpen, setSprintFieldSearchOpen,
                sprintFieldSearchIndex, setSprintFieldSearchIndex, sprintFieldSearchInputRef, sprintFieldSearchResults, sprintFieldSearchHidden,
                handleSprintFieldSearchKeyDown, isSprintFieldDirty, saveSprintFieldConfig,
                parentNameFieldIdDraft, setParentNameFieldIdDraft, parentNameFieldNameDraft, setParentNameFieldNameDraft,
                parentNameFieldSearchQuery, setParentNameFieldSearchQuery, parentNameFieldSearchOpen, setParentNameFieldSearchOpen,
                parentNameFieldSearchIndex, setParentNameFieldSearchIndex, parentNameFieldSearchInputRef, parentNameFieldSearchResults, parentNameFieldSearchHidden,
                handleParentNameFieldSearchKeyDown, isParentNameFieldDirty, saveParentNameFieldConfig,
                storyPointsFieldIdDraft, setStoryPointsFieldIdDraft, storyPointsFieldNameDraft, setStoryPointsFieldNameDraft,
                storyPointsFieldSearchQuery, setStoryPointsFieldSearchQuery, storyPointsFieldSearchOpen, setStoryPointsFieldSearchOpen,
                storyPointsFieldSearchIndex, setStoryPointsFieldSearchIndex, storyPointsFieldSearchInputRef, storyPointsFieldSearchResults, storyPointsFieldSearchHidden,
                handleStoryPointsFieldSearchKeyDown, isStoryPointsFieldDirty, saveStoryPointsFieldConfig,
                teamFieldIdDraft, setTeamFieldIdDraft, teamFieldNameDraft, setTeamFieldNameDraft,
                teamFieldSearchQuery, setTeamFieldSearchQuery, teamFieldSearchOpen, setTeamFieldSearchOpen,
                teamFieldSearchIndex, setTeamFieldSearchIndex, teamFieldSearchInputRef, teamFieldSearchResults, teamFieldSearchHidden,
                handleTeamFieldSearchKeyDown, isTeamFieldDirty, saveTeamFieldConfig,
                deliveryOwnerFieldIdDraft, setDeliveryOwnerFieldIdDraft, deliveryOwnerFieldNameDraft, setDeliveryOwnerFieldNameDraft,
                deliveryOwnerFieldSearchQuery, setDeliveryOwnerFieldSearchQuery, deliveryOwnerFieldSearchOpen, setDeliveryOwnerFieldSearchOpen,
                deliveryOwnerFieldSearchIndex, setDeliveryOwnerFieldSearchIndex, deliveryOwnerFieldSearchInputRef, deliveryOwnerFieldSearchResults, deliveryOwnerFieldSearchHidden,
                handleDeliveryOwnerFieldSearchKeyDown, isDeliveryOwnerFieldDirty, saveDeliveryOwnerFieldConfig,
                loadAllFieldConfigs, seedSharedFieldConfigs, anyFieldConfigDirty, dirtyFieldConfigCount,
            } = useJiraFieldPickers({ backendUrl: BACKEND_URL, jiraFields });
            settingsDraftSnapshotRef.current = {
                projects: jiraProjectsDraftSnapshot.projects,
                board: jiraProjectsDraftSnapshot.board,
                capacity: capacityDraftSnapshot,
                priorityWeights: priorityWeightsDraftSnapshot,
                issueTypes: jiraProjectsDraftSnapshot.issueTypes,
                sprintField: JSON.stringify({ fieldId: sprintFieldIdDraft, fieldName: sprintFieldNameDraft }),
                parentNameField: JSON.stringify({ fieldId: parentNameFieldIdDraft, fieldName: parentNameFieldNameDraft }),
                storyPointsField: JSON.stringify({ fieldId: storyPointsFieldIdDraft, fieldName: storyPointsFieldNameDraft }),
                teamField: JSON.stringify({ fieldId: teamFieldIdDraft, fieldName: teamFieldNameDraft }),
                deliveryOwnerField: JSON.stringify({ fieldId: deliveryOwnerFieldIdDraft, fieldName: deliveryOwnerFieldNameDraft }),
            };
            const pageLoadRefreshRef = useRef(false);
            const [jiraUrl, setJiraUrl] = useState('');
            const [selectedTasks, setSelectedTasks] = useState({});
            const [planningSelectionMode, setPlanningSelectionMode] = useState(PLANNING_SELECTION_MODE_MANUAL);
            const [canUndoPlanningSelection, setCanUndoPlanningSelection] = useState(false);
            const [showPlanning, setShowPlanning] = useState(savedPrefsRef.current.showPlanning ?? false);
            const [planningLayout, setPlanningLayout] = useState(savedPrefsRef.current.planningLayout === 'list' ? 'list' : 'table');
            const [planningToolbarHost, setPlanningToolbarHost] = useState(null);
            const [planningPanelExpanded, setPlanningPanelExpanded] = useState(null);
            // Planned Teams Effort is a one-line strip in Planning Table view until the user expands it (List always shows the full panel).
            const [teamsEffortExpanded, setTeamsEffortExpanded] = useState(savedPrefsRef.current.planningTeamsEffortExpanded === true);
            const [showStats, setShowStats] = useState(savedPrefsRef.current.showStats ?? false);
            const [showScenario, setShowScenario] = useState(savedPrefsRef.current.showScenario ?? false);
            const [showBoard, setShowBoard] = useState(savedPrefsRef.current.showBoard ?? false);
            const [boardAllWorkAvailable, setBoardAllWorkAvailable] = useState(null);
            const [boardBootstrapStatus, setBoardBootstrapStatus] = useState('loading');
            const [boardStrictScope, setBoardStrictScope] = useState('');
            const [showDependencies, setShowDependencies] = useState(true);
            const [searchQuery, setSearchQuery] = useState(savedPrefsRef.current.searchQuery ?? '');
            const [searchInput, setSearchInput] = useState(savedPrefsRef.current.searchQuery ?? ''); const [searchFocused, setSearchFocused] = useState(false);
            const normalizeSelectedTeams = (value) => {
                if (Array.isArray(value)) {
                    return value.length ? value : ['all'];
                }
                if (typeof value === 'string' && value.trim()) {
                    return [value];
                }
                return ['all'];
            };
            const [selectedTeams, setSelectedTeams] = useState(
                normalizeSelectedTeams(savedPrefsRef.current.selectedTeams ?? savedPrefsRef.current.selectedTeam ?? 'all')
            );
            const [epicDetails, setEpicDetails] = useState({});
            const [groupByInitiativeChoice, setGroupByInitiativeChoice] = useState(
                savedPrefsRef.current.groupByInitiativeChoice ?? null
            );
            const headerRef = useRef(null);
            const compactHeaderRef = useRef(null);
            const [compactHeaderOffset, setCompactHeaderOffset] = useState(0);
            const [compactStickyVisible, setCompactStickyVisible] = useState(false);
            const [planningOffset, setPlanningOffset] = useState(0);
            const [filterBarHeight, setFilterBarHeight] = useState(0);
            const [isPlanningStuck, setIsPlanningStuck] = useState(false);
            const planningPanelRef = useRef(null);
            const planningHydratedScopeRef = useRef('');
            const planningLoadedSelectionRef = useRef(null);
            const planningBaselineScopeRef = useRef('');
            const authResumeSnapshotRef = useRef(null);
            const pendingShellAuthResumeRef = useRef(null);
            const pendingPlanningAuthResumeRef = useRef(null);
            const authResumeShellSettledRef = useRef(null);
            const planningAuthResumeLoadRef = useRef(null);
            const planningAuthResumePersistenceFailedRef = useRef('');
            const [authResumeStagedRevision, setAuthResumeStagedRevision] = useState(0);
            const [planningAuthResumeLoadRevision, setPlanningAuthResumeLoadRevision] = useState(0);
            const clearAuthResumeWhenSettled = React.useCallback(() => {
                if (readPendingAuthenticationRequired()) return;
                if (planningAuthResumePersistenceFailedRef.current) return;
                if (pendingShellAuthResumeRef.current || pendingPlanningAuthResumeRef.current) return;
                clearAuthResumeState(getAuthResumeStorage(window));
            }, []);
            const teamSelectionHydratedScopeRef = useRef('');
            const teamSelectionHydratedSelectionRef = useRef(null); const teamSelectionCarryForwardRef = useRef(null);
            const teamSelectionSkipPersistScopeRef = useRef('');
            const resolveStatsView = (value) => (value === 'teams' || value === 'priority' || value === 'burnout' || value === 'cohort' || value === 'excludedCapacity' || value === 'monoCrossShare' || value === 'projectTrack') ? value : 'teams';
            const resolveStatsGraphMode = (value) => (value === 'weighted' || value === 'absolute') ? value : 'weighted';
            const resolveBurndownMetric = (value) => (value === 'issueCount' || value === 'storyPoints') ? value : 'storyPoints';
            const resolveCohortGroupBy = (value) => (value === 'month' || value === 'quarter') ? value : 'quarter';
            const [statsView, setStatsView] = useState(resolveStatsView(savedPrefsRef.current.statsView));
            const [statsGraphMode, setStatsGraphMode] = useState(resolveStatsGraphMode(savedPrefsRef.current.statsGraphMode));
            const [priorityHoverIndex, setPriorityHoverIndex] = useState(null);
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
            const [excludedCapacityRefreshNonce, setExcludedCapacityRefreshNonce] = useState(0), [issuePeopleStatsRevision, setIssuePeopleStatsRevision] = useState(0);
            const excludedCapacityEpicDropdownRef = useRef(null);
            const isStatsSourceOnlyStatsView = showStats && (statsView === 'excludedCapacity' || statsView === 'monoCrossShare' || statsView === 'projectTrack');
            const isCatchUpMode = selectedView === 'eng' && !showPlanning && !showStats && !showScenario && !showBoard;
            const isEpicRefreshMode = selectedView === 'eng' && !showStats && !showScenario && !showBoard;
            const boardScopeRequested = selectedView === 'eng' && showBoard && ['component', 'all_work'].includes(boardStrictScope)
                && adminSettingsGate.status !== 'missing';
            useEffect(() => { if (selectedView !== 'eng' || !showBoard) setBoardStrictScope(''); }, [selectedView, showBoard]);
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
            const [burnoutHoverPoint, setBurnoutHoverPoint] = useState(null);
            const [burnoutHoverTeamKey, setBurnoutHoverTeamKey] = useState(null);
            const [burnoutTaskFilter, setBurnoutTaskFilter] = useState(null);
            const burnoutCacheRef = useRef({});
            const cohortCacheRef = useRef({});
            const excludedCapacityCacheRef = useRef({});
            const excludedCapacityForceRefreshRef = useRef(false);
            const burnoutChartRef = useRef(null);
            const [showTeamDropdown, setShowTeamDropdown] = useState(false);
            const [teamDropdownQuery, setTeamDropdownQuery] = useState('');
            const teamDropdownRefs = useRef({ main: null, compact: null });
            const [sprintSearch, setSprintSearch] = useState('');
            const [showSprintDropdown, setShowSprintDropdown] = useState(false);
            const [sprintActiveOptionIndex, setSprintActiveOptionIndex] = useState(0);
            const sprintDropdownRefs = useRef({ main: null, compact: null });
            const sprintTriggerRefs = useRef({ main: null, compact: null });
            const sprintSelectorOriginRef = useRef(null);
            const boardScopeRetryRef = useRef(null);
            const [capacityEnabled, setCapacityEnabled] = useState(false);
            const [capacityState, setCapacityState] = useState(() => ({ capacityByTeam: {}, capacityTargetsByTeam: {}, capacityIssueCount: null, mutationEnabled: false, scopeSignature: '' }));
            const capacityStateRef = useRef(capacityState);
            capacityStateRef.current = capacityState;
            const [capacityLoading, setCapacityLoading] = useState(false);
            const [capacityReadRevision, setCapacityReadRevision] = useState(0);
            const [capacityReadError, setCapacityReadError] = useState('');
            const [capacityDataStale, setCapacityDataStale] = useState(false);
            const capacityReadModelRef = useRef(null);
            capacityReadModelRef.current = {
                capacityState, capacityLoading, capacityReadRevision, capacityReadError, capacityDataStale,
            };
            const [capacityRefreshNonce, setCapacityRefreshNonce] = useState(0);
            const capacityReadGenerationRef = useRef(0);
            const capacityReadAbortRef = useRef(null);
            const activeCapacityScopeRef = useRef(''), capacityScopeHoldRef = useRef(false), capacityScopePinRef = useRef(null), capacityScopeKeyRef = useRef(null);
            const searchInputRef = useRef(null);


            const [dependencyData, setDependencyData] = useState({}), [dependencyRefreshNonce, setDependencyRefreshNonce] = useState(0);
            const [dependencyFocus, setDependencyFocus] = useState(null);
            const [dependencyHover, setDependencyHover] = useState(null);
            const [dependencyLookupCache, setDependencyLookupCache] = useState({});
            const [dependencyLookupLoading, setDependencyLookupLoading] = useState(false);
            const [hideExcludedStats, setHideExcludedStats] = useState(savedPrefsRef.current.hideExcludedStats ?? true);
            const [showMissingAlert, setShowMissingAlert] = useState(savedPrefsRef.current.showMissingAlert ?? true);
            const [showBlockedAlert, setShowBlockedAlert] = useState(savedPrefsRef.current.showBlockedAlert ?? true);
            const [showPostponedAlert, setShowPostponedAlert] = useState(savedPrefsRef.current.showPostponedAlert ?? true);
            const [showBacklogAlert, setShowBacklogAlert] = useState(savedPrefsRef.current.showBacklogAlert ?? true);
            const [showMissingTeamAlert, setShowMissingTeamAlert] = useState(savedPrefsRef.current.showMissingTeamAlert ?? true);
            const [showMissingLabelsAlert, setShowMissingLabelsAlert] = useState(savedPrefsRef.current.showMissingLabelsAlert ?? true);
            const [showNeedsStoriesAlert, setShowNeedsStoriesAlert] = useState(savedPrefsRef.current.showNeedsStoriesAlert ?? savedPrefsRef.current.showCreateStoriesAlert ?? savedPrefsRef.current.showWaitingAlert ?? true);
            const [showWaitingAlert, setShowWaitingAlert] = useState(savedPrefsRef.current.showWaitingAlert ?? true);
            const [showEmptyEpicAlert, setShowEmptyEpicAlert] = useState(savedPrefsRef.current.showEmptyEpicAlert ?? true);
            const [showDoneEpicAlert, setShowDoneEpicAlert] = useState(savedPrefsRef.current.showDoneEpicAlert ?? true);
            const [showAlertsPanel, setShowAlertsPanel] = useState(savedPrefsRef.current.showAlertsPanel ?? true);
            const [dismissedAlertKeys, setDismissedAlertKeys] = useState([]);
            const [dismissedStoryRequirementIds, setDismissedStoryRequirementIds] = useState([]);
            const [storyRequirementNavigationError, setStoryRequirementNavigationError] = useState('');
            const [alertCelebrationPieces, setAlertCelebrationPieces] = useState([]);
            const [configRefreshNonce, setConfigRefreshNonce] = useState(0);
            const alertDismissedRef = useRef(false);
            const alertCelebrationTimeoutRef = useRef(null);
            const alertStabilizeFrameRef = useRef(null);
            const alertHighlightRef = useRef(null);
            const alertHighlightTimeoutRef = useRef(null);
            const [updateInfo, setUpdateInfo] = useState(null);
            const [showUpdateModal, setShowUpdateModal] = useState(false);
            const [updateDismissedHash, setUpdateDismissedHash] = useState(savedPrefsRef.current.updateDismissedHash || '');
            const [showBackToTop, setShowBackToTop] = useState(false);
            const [stickyEpicFocusKey, setStickyEpicFocusKey] = useState(null);
            const epicRefMap = useRef(new Map());
            const stickyEpicFrameRef = useRef(null);
            const groupStateRef = useRef(new Map()), issueEditStateRef = useRef(createEngIssueEditState());
            const restoringGroupRef = useRef(false);
            const activeGroupRef = useRef(null);
            const sprintFetchControllersRef = useRef(new Set());
            const lastLoadedSprintRef = useRef(null);
            const sprintLoadRef = useRef({ sprintId: null, product: false, tech: false });
            const [catchUpAlertRefreshNonce, setCatchUpAlertRefreshNonce] = useState(0);
            const catchUpAlertLoadRef = useRef('');
            const catchUpAlertForceRefreshRef = useRef(false);
            const catchUpAlertVersionRef = useRef(0);
            const loadEpochRef = useRef(0); const alertCohortRef = useRef(null); const dependencySkipRef = useRef(createDependencySkip()); const recentEditKeysRef = useRef(new Map());
            const groupLoadVersionRef = useRef(0);
            const rearmCatchUpAlerts = () => { catchUpAlertLoadRef.current = ''; catchUpAlertForceRefreshRef.current = true; catchUpAlertVersionRef.current += 1; setCatchUpAlertRefreshNonce(value => value + 1); };
            const alertCohortListenersRef = useRef(new Set()); const notifyAlertCohortSettle = outcome => [...alertCohortListenersRef.current].forEach(listener => listener(outcome));
            const subscribeAlertCohortSettle = listener => { alertCohortListenersRef.current.add(listener); return () => { alertCohortListenersRef.current.delete(listener); }; };
            const storyRequirementScopeRef = useRef('');
            const pendingConfigRefreshRef = useRef(0);
            const configRefreshTargetRef = useRef('none');
            const abortSprintFetches = React.useCallback(() => {
                sprintFetchControllersRef.current.forEach(controller => {
                    try {
                        controller.abort();
                    } catch (err) {
                        // ignore abort errors
                    }
                });
                sprintFetchControllersRef.current.clear();
            }, []);
            const selectedSprintInfo = React.useMemo(() => {
                if (!selectedSprint) return null;
                return (availableSprints || []).find(sprint => String(sprint.id) === String(selectedSprint)) || null;
            }, [availableSprints, selectedSprint]);
            const {
                teamCatalogState,
                loadingTeams,
                teamCatalogReady,
                teamMembershipState,
                fetchAllTeamsFromJira,
                invalidateTeamMembership,
            } = useTeamCatalogLifecycle({
                backendUrl: BACKEND_URL,
                showSettings: showGroupManage,
                selectedSprintInfo,
                sprintCatalogIdentity: sprintCatalogState.identity,
                sprintCatalogGeneration: sprintCatalogState.generation,
                sprintBrowserContextId: sprintCatalogState.browserContextId,
                sharedConfigRevision,
                authResumeStagedRevision,
                setGroupDraftError,
            });
            const refreshHomeTokenConnectionStatus = React.useCallback(async () => {
                try {
                    const payload = await fetchHomeTokenConnection(BACKEND_URL);
                    const nextConnection = payload || { connected: false };
                    clearServerConnectionError();
                    setHomeTokenConnection(nextConnection);
                    return nextConnection;
                } catch (err) {
                    if (isAuthenticationRequiredError(err)) return null;
                    reportServerConnectionError(err);
                    setHomeTokenConnection({ connected: false });
                    return { connected: false };
                } finally {
                    setHomeTokenConnectionLoaded(true);
                }
            }, [clearServerConnectionError, reportServerConnectionError]);
            const markHomeTokenRequired = React.useCallback(() => {
                setHomeTokenConnection({ connected: false });
                setHomeTokenConnectionLoaded(true);
                void refreshHomeTokenConnectionStatus();
            }, [refreshHomeTokenConnectionStatus]);
            const handleHomeTokenConnectionChange = React.useCallback((connection) => {
                const nextConnection = connection || { connected: false };
                setHomeTokenConnection(nextConnection);
                setHomeTokenConnectionLoaded(true);
            }, []);
            useEffect(() => {
                void refreshHomeTokenConnectionStatus();
            }, [refreshHomeTokenConnectionStatus]);
            const {
                currentDashboardView, trackAppError, trackApiResult, trackEpmAction, trackFilterChanged,
                trackIssueStatusAction, trackIssuePriorityAction, trackIssueProjectTrackAction, trackIssueFieldEditAction, trackEpicRefreshAction, trackPlanningCapacityAction, trackPlanningSelection, trackScenarioAction, trackSearch, trackSelectContent,
                trackSettingsAction, trackSortChanged, trackStatsAction, trackProductEvent,
            } = useDashboardAnalytics(React, { authMode, selectedView, showPlanning, showStats, showScenario, showBoard, serverConnectionError });
            const {
                groupsConfig,
                setGroupsConfig,
                groupsLoading,
                setGroupsLoading,
                groupsError,
                setGroupsError,
                boardGroupsReadFailed,
                setBoardGroupsReadFailed,
                acceptedGroupsConfigRef,
                groupsReadGenerationRef,
                groupsSaveReadFenceRef,
                groupWarnings,
                groupConfigSource,
                groupDraft,
                setGroupDraft,
                groupsConfigConflict,
                setGroupsConfigConflict,
                groupImportText,
                setGroupImportText,
                showGroupImport,
                setShowGroupImport,
                showGroupAdvanced,
                setShowGroupAdvanced,
                setTeamNameInputs,
                setTeamSearchQuery,
                teamSearchOpen,
                setTeamSearchOpen,
                setTeamSearchIndex,
                teamSearchFeedback,
                setTeamSearchFeedback,
                teamSearchInputRefs,
                teamChipLastRef,
                labelSearchQuery,
                setLabelSearchQuery,
                labelSearchOpen,
                setLabelSearchOpen,
                labelSearchResults,
                setLabelSearchResults,
                labelSearchLoading,
                setLabelSearchLoading,
                labelSearchIndex,
                setLabelSearchIndex,
                labelAddOpen,
                setLabelAddOpen,
                labelAddButtonRefs,
                labelSearchRequestIdRef,
                labelSearchDebounceRef,
                groupSearchQuery,
                setGroupSearchQuery,
                activeGroupDraftId,
                setActiveGroupDraftId,
                groupDraftBaselineRef,
                componentSearchQuery,
                setComponentSearchQuery,
                setComponentSearchResults,
                componentSearchOpen,
                setComponentSearchOpen,
                componentSearchIndex,
                setComponentSearchIndex,
                componentSearchLoading,
                setComponentSearchLoading,
                excludedEpicSearchQuery,
                setExcludedEpicSearchQuery,
                setExcludedEpicSearchResults,
                excludedEpicSearchOpen,
                setExcludedEpicSearchOpen,
                excludedEpicSearchIndex,
                setExcludedEpicSearchIndex,
                excludedEpicSearchLoading,
                setExcludedEpicSearchLoading,
                excludedEpicSearchInputRef,
                excludedEpicChipLastRef,
                adHocEpicSearchQuery,
                setAdHocEpicSearchResults,
                adHocEpicSearchOpen,
                adHocEpicSearchIndex,
                setAdHocEpicSearchIndex,
                adHocEpicSearchLoading,
                setAdHocEpicSearchLoading,
                adHocEpicSearchInputRef,
                adHocEpicChipLastRef,
                personalGroupPreferencesEnabled,
                groupPreferences,
                setGroupPreferences,
                visibleGroupDraftIds,
                setVisibleGroupDraftIds,
                favoriteGroupDraftId,
                setFavoriteGroupDraftId,
                setFavoriteGroupDraft,
                favoriteGroupValidationError,
                setGroupPreferencesSaving,
                groupVisibilitySaving,
                isGroupVisibilityDraftDirty,
                visibleControlGroups,
                initializeGroupPreferencesDraft,
                isGroupVisibleInControls,
                toggleGroupVisibleInControls,
                firstRunFavoriteGroupId,
                selectFirstRunFavoriteGroup,
                saveFirstRunGroupPreferences,
                firstRunSaving,
                firstRunError,
                persistGroupPreferences,
                loadGroupsConfig,
                loadTeamsFromCurrentView,
                groupDraftSignature,
                isGroupBoardDraftDirty,
                closeAllTeamSearchDropdowns,
                addGroupDraftRow,
                updateGroupDraftName,
                duplicateGroupDraft,
                updateGroupDraftBoard,
                addTeamToGroup,
                removeTeamFromGroup,
                removeTeamLabelFromGroup,
                handleTeamSearchChange,
                handleTeamSearchFocus,
                handleTeamSearchBlur,
                handleTeamSearchKeyDown,
                removeGroupDraft,
                toggleDefaultGroupDraft,
                applySavedGroupsConfig,
                filteredComponentSearchResults,
                filteredExcludedEpicSearchResults,
                filteredAdHocEpicSearchResults,
                handleComponentSearchKeyDown,
                addGroupMissingInfoComponent,
                removeGroupMissingInfoComponent,
                addGroupExcludedCapacityEpic,
                removeGroupExcludedCapacityEpic,
                addGroupAdHocCapacityEpic,
                removeGroupAdHocCapacityEpic,
                handleExcludedEpicSearchKeyDown,
                handleAdHocEpicSearchKeyDown,
                handleExcludedEpicSearchChange,
                handleExcludedEpicSearchFocus,
                handleExcludedEpicSearchBlur,
                handleAdHocEpicSearchChange,
                handleAdHocEpicSearchFocus,
                handleAdHocEpicSearchBlur,
                exportGroupsConfig,
                importGroupsConfig,
                availableTeams,
                teamNameLookup,
                resolveTeamName,
                activeGroupDraft,
                filteredGroupDrafts,
                teamCacheLabel,
                teamCatalogCanRefresh,
                activeTeamQuery,
                activeTeamResultsLimited,
                activeTeamAvailabilityKey,
                activeTeamIndex,
                getLabelSearchResults,
                closeTeamLabelSearch,
                selectTeamLabel,
                handleLabelSearchKeyDown,
                scheduleJiraLabelSearch,
            } = useTeamGroupSettings({
                BACKEND_URL,
                activeGroupId,
                clearServerConnectionError,
                firstRunConfigurationActive,
                getTeamOptions: () => teamOptions,
                markConnectionBootstrapHealthy,
                reportServerConnectionError,
                savedPrefsRef,
                selectedSprintInfo,
                setActiveGroupId,
                setGroupDraftError,
                setShowGroupListMobile,
                showGroupManage,
                teamCatalogState,
                teamMembershipState,
                trackSettingsAction,
            });
            const {
                epmConfigDraft,
                epmConfigDraftRef,
                epmConfigDraftGenerationRef,
                setEpmConfigDraft,
                epmConfigLoading,
                setEpmConfigLoading,
                epmConfigSaving,
                epmConfigLoaded,
                epmSettingsProjects,
                epmSettingsProjectsLoading,
                epmSettingsProjectsError,
                epmSettingsProjectsLoaded,
                setEpmSettingsProjectsLoaded,
                epmSettingsProjectsLoadedAt,
                setEpmSettingsProjectsLoadedAt,
                epmSettingsProjectsFetchMeta,
                setEpmSettingsProjectsFetchMeta,
                epmSettingsProjectsRefreshing,
                removedEpmProjectIds,
                setRemovedEpmProjectIds,
                epmSettingsProjectSort,
                epmSettingsProjectView,
                setEpmSettingsProjectView,
                epmSettingsTab,
                setEpmSettingsTab,
                epmLabelShowAll,
                setEpmLabelShowAll,
                epmLabelChanging,
                setEpmLabelChanging,
                epmLabelMenuAnchor,
                setEpmLabelMenuAnchor,
                epmLabelMenuInputRef,
                epmConfigBaselineRef,
                epmScopeMeta,
                setEpmScopeMeta,
                setEpmRootGoals,
                epmSubGoals,
                epmRootGoalsLoading,
                setEpmRootGoalsLoading,
                epmSubGoalsLoading,
                epmRootGoalsError,
                setEpmRootGoalsError,
                epmSubGoalsError,
                epmRootGoalQuery,
                setEpmRootGoalQuery,
                epmSubGoalQuery,
                setEpmSubGoalQuery,
                setEpmRootGoalOpen,
                setEpmSubGoalOpen,
                setEpmRootGoalIndex,
                setEpmSubGoalIndex,
                epmSettingsProjectsCacheRef,
                loadEpmConfig,
                loadEpmScopeMeta,
                loadEpmGoals,
                ensureEpmSettingsProjectsLoaded,
                saveEpmConfig,
                updateEpmLabelPrefixDraft,
                updateEpmProjectDraft,
                getEpmLabelRowKey,
                getEpmLabelSearchResults,
                addCustomEpmProjectDraft,
                removeEpmProjectDraft,
                deleteEpmProjectRow,
                loadEpmProjectLabels,
                requestEpmLabelFocus,
                registerEpmLabelInput,
                selectEpmProjectLabel,
                openEpmLabelMenu,
                handleEpmLabelSearchKeyDown,
                loadEpmSubGoalsForRoot,
                selectEpmRootGoal,
                clearEpmRootGoal,
                clearEpmSubGoal,
                selectEpmSubGoal,
                normalizeEpmConfigDraft,
                applySavedEpmConfig,
                filteredEpmRootGoals,
                filteredEpmSubGoals,
                selectedEpmRootGoal,
                selectedEpmSubGoals,
                visibleEpmRootGoals,
                visibleEpmSubGoals,
                activeEpmRootGoalIndex,
                activeEpmSubGoalIndex,
                showEpmRootGoalResults,
                showEpmSubGoalResults,
                handleEpmRootGoalSearchKeyDown,
                handleEpmSubGoalSearchKeyDown,
                isEpmConfigDirty,
                hasSavedEpmScope,
                savedEpmSubGoalKeys,
                savedEpmRootGoalKey,
                epmProjectPrerequisites,
                canLoadEpmProjects,
                epmSettingsProjectsCacheKey,
                epmSettingsProjectRows,
                openEpmSettingsTab,
                focusEpmScopeField,
                handleEpmSettingsTabKeyDown,
                setTrackedEpmSettingsProjectSort,
            } = useEpmSettings({
                BACKEND_URL,
                canEditEpmConfiguration,
                getEpmViewActions: () => ({ refreshEpmProjects, setEpmProjects, setEpmProjectsError }),
                labelSearchIndex,
                labelSearchOpen,
                labelSearchQuery,
                labelSearchRequestIdRef,
                labelSearchResults,
                setGroupDraftError,
                setGroupManageTab,
                setLabelSearchIndex,
                setLabelSearchLoading,
                setLabelSearchOpen,
                setLabelSearchQuery,
                setLabelSearchResults,
                setShowGroupManage,
                trackSettingsAction,
                trackSortChanged,
            });
            const onboardingAvailable = isOnboardingAvailable(authMode, groupsConfig.source);
            const {
                advanceFirstRunConfigurationGuide,
                backFirstRunConfigurationGuide,
                cancelFirstRunConfiguration,
                closeFirstRunSetupChoice,
                configureFirstRunGroup,
                continueFirstRunSetupChoice,
                firstRunConfigurationGuideVisible,
                firstRunHasCommittedSection,
                openFirstRunSetupChoice,
                retryFirstRunConfiguration,
            } = useFirstRunConfiguration({
                activeGroupDraft,
                activeGroupId,
                adminAccess,
                boardIdDraft,
                boardNameDraft,
                capacityFieldIdDraft,
                capacityFieldNameDraft,
                capacityProjectDraft,
                deliveryOwnerFieldIdDraft,
                deliveryOwnerFieldNameDraft,
                dispatchFirstRunConfigurationSession,
                epmConfigDraft,
                firstRunConfigurationActive,
                firstRunConfigurationSession,
                firstRunSetupChoice,
                getCloseGroupManage: () => closeGroupManage,
                getSaveAllSettings: () => saveAllSettings,
                groupDraftBaselineRef,
                groupPreferences,
                groupsConfig,
                groupsConfigConflict,
                issueTypesDraft,
                parentNameFieldIdDraft,
                parentNameFieldNameDraft,
                pendingFirstRunConfigurationRef,
                pendingFirstRunGroupPreferencesRef,
                priorityWeightsDraft,
                saveFirstRunGroupPreferences,
                selectedProjectsDraft,
                setActiveGroupId,
                setDepartmentSettingsTab,
                setFirstRunConfigurationTargetGroupId,
                setFirstRunSetupChoice,
                setGroupDraft,
                setGroupManageTab,
                setGroupPreferences,
                setGroupsConfig,
                setSharedConfigRevision,
                setShowGroupListMobile,
                setShowGroupManage,
                setWorkspaceConfigConflict,
                sharedConfigRevisionRef,
                showGroupManage,
                sprintFieldIdDraft,
                sprintFieldNameDraft,
                storyPointsFieldIdDraft,
                storyPointsFieldNameDraft,
                teamFieldIdDraft,
                teamFieldNameDraft,
                workspaceConfigConflict,
            });
            useEffect(() => {
                if (!homeTokenConnectionLoaded) return;
                if (showEpmNavigation) {
                    if (!restoredInitialEpmViewRef.current && savedInitialViewRef.current === 'epm') {
                        restoredInitialEpmViewRef.current = true;
                        setSelectedView('epm');
                    }
                    return;
                }
                if (selectedView === 'epm') {
                    setSelectedView('eng');
                }
            }, [homeTokenConnectionLoaded, showEpmNavigation, selectedView]);
            useEpmLabelMenuEffects({
                epmLabelMenuAnchor,
                epmLabelMenuInputRef,
                epmSettingsTab,
                groupManageTab,
                setEpmLabelMenuAnchor,
                setRemovedEpmProjectIds,
                showGroupManage,
            });
            const filteredSprints = React.useMemo(() => {
                if (!sprintSearch.trim()) return availableSprints;
                const query = sprintSearch.trim().toLowerCase();
                return (availableSprints || []).filter(sprint => {
                    const nameMatch = String(sprint.name || '').toLowerCase().includes(query);
                    const state = (sprint.state || '').toLowerCase();
                    const stateLabel = state === 'closed' ? 'c' : state === 'active' ? 'a' : state === 'future' ? 'f' : '';
                    return nameMatch || stateLabel === query;
                });
            }, [availableSprints, sprintSearch]);

            const sprintOptionDomId = (surface, option) => {
                const suffix = option.kind === 'sprint'
                    ? `sprint-${String(option.sprint.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`
                    : option.scope.replace(/_/g, '-');
                return `sprint-${surface}-option-${suffix}`;
            };

            const getSprintSelectorOptions = (boardScopeControl) => {
                const normalizedSearch = sprintSearch.trim().toLowerCase();
                const options = [];
                if (boardScopeControl && (!normalizedSearch || 'all work'.includes(normalizedSearch))) {
                    options.push({
                        kind: 'scope', scope: 'all_work', label: 'All work',
                        readiness: engSprintSelectorState.allWorkReadiness,
                    });
                }
                if (boardScopeControl && (!normalizedSearch || 'component'.includes(normalizedSearch))) {
                    options.push({
                        kind: 'scope', scope: 'component', label: 'Component',
                        readiness: engSprintSelectorState.componentReadiness,
                    });
                }
                filteredSprints.forEach(sprint => options.push({
                    kind: 'sprint', sprint, label: String(sprint.name || 'Sprint'),
                }));
                return options;
            };

            const closeSprintSelector = ({ restoreFocus = false } = {}) => {
                const origin = sprintSelectorOriginRef.current;
                setShowSprintDropdown(false);
                setSprintActiveOptionIndex(0);
                sprintSelectorOriginRef.current = null;
                if (!restoreFocus || !origin) return;
                window.requestAnimationFrame(() => sprintTriggerRefs.current[origin]?.focus?.());
            };

            const selectBoardScope = (scope) => {
                if (!engSprintSelectorState.boardSelectable) return;
                if (boardStrictScope !== scope) {
                    trackFilterChanged('sprint', {
                        sprint_selection_state: scope,
                        source_surface: 'board',
                        scope_type: scope,
                    });
                    setBoardStrictScope(scope);
                }
                closeSprintSelector({ restoreFocus: true });
            };

            const selectOrdinarySprint = (sprint, boardScopeControl) => {
                const commitSelection = () => applyOrdinarySprint(sprint, boardScopeControl);
                if (String(selectedSprint) !== String(sprint.id) && planningReviewGuardRef.current) {
                    void planningReviewGuardRef.current(commitSelection);
                } else commitSelection();
            };
            const applyOrdinarySprint = (sprint, boardScopeControl) => {
                const sameOrdinarySelection = !boardStrictScope
                    && String(selectedSprint) === String(sprint.id);
                const projectTrackSprintId = showStats && statsView === 'projectTrack'
                    ? String(sprint.id)
                    : '';
                const projectTrackRangeMatches = projectTrackSprintId
                    && String(excludedCapacityStartSprintId) === projectTrackSprintId
                    && String(excludedCapacityEndSprintId) === projectTrackSprintId;
                if (!sameOrdinarySelection) {
                    const state = (sprint.state || '').toLowerCase();
                    trackFilterChanged('sprint', {
                        sprint_selection_state: analyticsToken(state || 'unknown'),
                        source_surface: currentDashboardView(),
                        scope_type: boardScopeControl ? 'sprint' : currentDashboardView(),
                    });
                    teamSelectionCarryForwardRef.current = activeGroupId ? {
                        scopeKey: buildTeamSelectionScopeKey({ sprintId: sprint.id, groupId: activeGroupId }),
                        selectedTeams: normalizeSelectedTeams(selectedTeams),
                    } : null;
                    setSelectedSprint(sprint.id);
                    setSprintName(sprint.name);
                }
                if (projectTrackSprintId && (!sameOrdinarySelection || !projectTrackRangeMatches)) {
                    excludedCapacityForceRefreshRef.current = true;
                    setExcludedCapacityStartSprintId(projectTrackSprintId);
                    setExcludedCapacityEndSprintId(projectTrackSprintId);
                    setExcludedCapacityRefreshNonce(previous => previous + 1);
                }
                if (boardScopeControl) setBoardStrictScope('');
                closeSprintSelector({ restoreFocus: true });
            };

            const commitSprintSelectorOption = (option, boardScopeControl) => {
                if (!option) return;
                if (option.kind === 'scope') {
                    selectBoardScope(option.scope);
                    return;
                }
                selectOrdinarySprint(option.sprint, boardScopeControl);
            };

            const openSprintSelector = (surface, options) => {
                sprintSelectorOriginRef.current = surface;
                const selectedIndex = options.findIndex(option => option.kind === 'scope'
                    ? option.scope === boardStrictScope
                    : !boardStrictScope && String(option.sprint.id) === String(selectedSprint));
                setSprintActiveOptionIndex(Math.max(0, selectedIndex));
                applyExclusiveDropdownState('sprint', false);
            };

            const filteredControlGroups = React.useMemo(() => {
                const query = groupDropdownQuery.trim().toLowerCase();
                if (!query) return visibleControlGroups || [];
                return (visibleControlGroups || []).filter(group =>
                    String(group?.name || '').toLowerCase().includes(query)
                );
            }, [visibleControlGroups, groupDropdownQuery]);

            useEffect(() => {
                if (!showGroupDropdown) setGroupDropdownQuery('');
            }, [showGroupDropdown]);

            useEffect(() => {
                if (!showTeamDropdown) setTeamDropdownQuery('');
            }, [showTeamDropdown]);

            useEffect(() => {
                if (!showSprintDropdown) {
                    setSprintSearch('');
                    setSprintActiveOptionIndex(0);
                }
            }, [showSprintDropdown]);

            const getActiveControlSurfaceName = () => (compactStickyVisible ? 'compact' : 'main');

            const getActiveDropdownNode = (dropdownRefs) => {
                const surface = getActiveControlSurfaceName();
                return dropdownRefs.current[surface] || null;
            };

            const applyExclusiveDropdownState = (kind, isOpen) => {
                const next = getNextExclusiveDropdownState(kind, isOpen);
                setShowSprintDropdown(next.sprint);
                setShowGroupDropdown(next.group);
                setShowTeamDropdown(next.team);
                setShowEpmProjectDropdown(next.project);
                setShowEpmSubGoalFilterDropdown(next.subGoal);
                setShowEpmSortDropdown(next.sort);
            };

            const clearEngGroupScopeData = React.useCallback(({ clearScenario = true } = {}) => {
                abortSprintFetches();
                groupLoadVersionRef.current += 1;
                groupStateRef.current.clear();
                setTasksFetched(false);
                setProductTasks([]);
                setTechTasks([]);
                setLoadedProductTasks([]);
                setLoadedTechTasks([]);
                setTechLoaded(false);
                setEpicDetails({});
                setProductEpicsInScope([]);
                setTechEpicsInScope([]);
                setReadyToCloseProductTasks([]);
                setReadyToCloseTechTasks([]);
                setReadyToCloseProductEpicsInScope([]);
                setReadyToCloseTechEpicsInScope([]);
                setMissingPlanningInfoTasks([]);
                setMissingInfoEpics([]);
                setBacklogProductEpics([]);
                setBacklogTechEpics([]);
                setDependencyData({});
                clearStorySubtasks();
                burnoutCacheRef.current = {};
                cohortCacheRef.current = {};
                excludedCapacityCacheRef.current = {};
                setBurnoutData(null);
                setBurnoutError('');
                setBurnoutLoading(false);
                setBurnoutTaskFilter(null);
                setCohortData(null);
                setCohortError('');
                setCohortLoading(false);
                setCohortSelectedRow(null);
                setExcludedCapacityData(null);
                setExcludedCapacityError('');
                setExcludedCapacityLoading(false);
                setCapacityState({ capacityByTeam: {}, capacityTargetsByTeam: {}, capacityIssueCount: null, mutationEnabled: false, scopeSignature: '' });
                setCapacityLoading(false);
                setCapacityReadError('');
                setCapacityDataStale(false);
                if (clearScenario) {
                    setScenarioData(null);
                    setScenarioError('');
                    setScenarioLoading(false);
                }
                setLoading(false);
                setError('');
                setProductTasksLoading(false);
                setTechTasksLoading(false);
                sprintLoadRef.current = { sprintId: selectedSprint, product: false, tech: false };
                lastLoadedSprintRef.current = null;
                catchUpAlertLoadRef.current = '';
                catchUpAlertForceRefreshRef.current = false;
                catchUpAlertVersionRef.current += 1;
            }, [abortSprintFetches, selectedSprint]);

            const invalidateSprintDataForConfigSave = (refreshTarget) => {
                if (!selectedSprint) return;
                clearEngGroupScopeData({ clearScenario: refreshTarget === 'scenario' });
            };

            const queueConfigSaveRefresh = (refreshTarget) => {
                if (!selectedSprint) return;
                configRefreshTargetRef.current = refreshTarget;
                setConfigRefreshNonce((prev) => {
                    const next = prev + 1;
                    pendingConfigRefreshRef.current = next;
                    return next;
                });
            };
            const firstFutureSprintId = React.useMemo(() => {
                const future = (availableSprints || []).filter(sprint => (sprint.state || '').toLowerCase() === 'future');
                if (!future.length) return null;
                const ordered = [...future].sort((a, b) => {
                    const aTime = Date.parse(a.startDate || '');
                    const bTime = Date.parse(b.startDate || '');
                    if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) {
                        return aTime - bTime;
                    }
                    return String(a.name || '').localeCompare(String(b.name || ''));
                });
                return ordered[0]?.id ?? null;
            }, [availableSprints]);
            const selectedSprintState = (selectedSprintInfo?.state || '').toLowerCase();
            const isCompletedSprintSelected = selectedSprintState === 'closed';
            const isFutureSprintSelected = selectedSprintState === 'future';
            const isFirstFutureSprintSelected = firstFutureSprintId
                && selectedSprint !== null
                && String(firstFutureSprintId) === String(selectedSprint);

            useEffect(() => {
                // Load configuration on mount. Sprint discovery waits for department onboarding
                // below so a first-time user does not start Jira work before choosing a scope.
                loadConfig();
                loadGroupsConfig();
            }, []);

            useEffect(() => {
                // Sprint discovery also waits for the config bootstrap: an unconfigured workspace fetches nothing.
                if (groupsLoading || groupPreferences.onboardingRequired || adminSettingsGate.status !== 'clear') return;
                loadSprints();
            }, [groupsLoading, groupPreferences.onboardingRequired, adminSettingsGate.status]);

            useEffect(() => {
                let cancelled = false;
                const fetchVersion = async () => {
                    try {
                        const data = await fetchVersionInfo(BACKEND_URL);
                        if (!cancelled) {
                            setUpdateInfo(data);
                        }
                    } catch (err) {
                        // ignore version check failures
                    }
                };
                fetchVersion();
                return () => {
                    cancelled = true;
                };
            }, []);

            useEffect(() => {
                return () => {
                    abortSprintFetches();
                };
            }, [abortSprintFetches]);

            useSettingsAutoOpenEffect({
                groupConfigSource,
                groupsLoading,
                setShowGroupManage,
            });

            useEffect(() => {
                if (!showGroupManage) return;
                const normalized = normalizeGroupsConfig(groupsConfig);
                const pendingFirstRunConfiguration = pendingFirstRunConfigurationRef.current;
                pendingFirstRunConfigurationRef.current = null;
                const pendingDraft = pendingFirstRunConfiguration?.draft || null;
                const nextGroupDraft = pendingDraft ? {
                    ...normalized,
                    groups: [...(normalized.groups || []), pendingDraft],
                } : normalized;
                const targetGroupId = pendingDraft?.id || pendingFirstRunConfiguration?.sourceGroupId || firstRunConfigurationTargetGroupId || resolveInitialGroupId(normalized);
                setGroupDraft(nextGroupDraft);
                groupDraftBaselineRef.current = JSON.stringify(buildSharedGroupsPayload(normalized));
                initializeGroupPreferencesDraft(normalized, activeGroupId);
                if (pendingFirstRunConfiguration && targetGroupId) {
                    const initialVisibleGroupIds = groupPreferences.customized
                        ? (groupPreferences.visibleGroupIds || [])
                        : (normalized.groups || []).map(group => group.id);
                    pendingFirstRunGroupPreferencesRef.current = buildPendingFirstRunGroupPreferencesDraft(
                        initialVisibleGroupIds,
                        targetGroupId
                    );
                    setVisibleGroupDraftIds(pendingFirstRunGroupPreferencesRef.current.visibleGroupIds);
                    setFavoriteGroupDraftId(targetGroupId);
                }
                setGroupDraftError('');
                setGroupImportText('');
                setShowGroupImport(false);
                setShowGroupAdvanced(false);
                setGroupSearchQuery('');
                setTeamSearchQuery({});
                setTeamSearchOpen({});
                setTeamSearchIndex({});
                setTeamSearchFeedback({});
                setShowGroupDiscardConfirm(false);
                setShowGroupListMobile(Boolean(pendingFirstRunConfiguration));
                setProjectSearchQuery('');
                setActiveGroupDraftId(targetGroupId);
                if (authMode !== 'atlassian_oauth') {
                    loadSelectedProjects();
                    loadPriorityWeightsConfig();
                    loadBoardConfig();
                    loadCapacityConfig();
                    loadAllFieldConfigs();
                    loadIssueTypesConfig();
                }
                fetchAvailableIssueTypes();
                if (!jiraProjects.length) fetchJiraProjects();
                setTeamNameInputs(loadTeamsFromCurrentView());
            }, [showGroupManage]);

            useEpmSettingsLoadEffect({
                applySavedEpmConfig,
                epmConfigDraft,
                epmConfigDraftGenerationRef,
                epmConfigDraftRef,
                groupManageTab,
                isEpmConfigDirty,
                loadEpmConfig,
                loadEpmGoals,
                loadEpmScopeMeta,
                loadEpmSubGoalsForRoot,
                setEpmConfigLoading,
                setEpmRootGoalIndex,
                setEpmRootGoalOpen,
                setEpmRootGoalQuery,
                setEpmRootGoals,
                setEpmRootGoalsError,
                setEpmRootGoalsLoading,
                setEpmScopeMeta,
                setEpmSubGoalIndex,
                setEpmSubGoalOpen,
                setEpmSubGoalQuery,
                setGroupDraftError,
                showGroupManage,
            });

            useTeamGroupSelectionEffect({
                activeGroupDraftId,
                firstRunConfigurationActive,
                firstRunConfigurationTargetGroupId,
                groupDraft,
                setActiveGroupDraftId,
                showGroupManage,
            });

            useEffect(() => {
                if (!perfEnabled) return;
                const interval = window.setInterval(() => {
                    const current = perfCountersRef.current;
                    const last = perfLastRef.current;
                    const snapshot = {
                        renders: current.renders - last.renders,
                        edgeRequests: current.edgeRequests - last.edgeRequests,
                        edgeFrames: current.edgeFrames - last.edgeFrames,
                        edgeComputes: current.edgeComputes - last.edgeComputes,
                        layoutReads: current.layoutReads - last.layoutReads,
                        scrollReads: current.scrollReads - last.scrollReads,
                        laneStacking: current.laneStacking - last.laneStacking,
                        statsBuild: (current.statsBuild || 0) - (last.statsBuild || 0)
                    };
                    perfLastRef.current = { ...current };
                    const stateChanges = perfStateCountsRef.current || {};
                    const lastStateChanges = perfStateLastRef.current || {};
                    const stateDiff = {};
                    Object.keys(stateChanges).forEach((key) => {
                        const diff = (stateChanges[key] || 0) - (lastStateChanges[key] || 0);
                        if (diff > 0) {
                            stateDiff[key] = diff;
                        }
                    });
                    perfStateLastRef.current = { ...stateChanges };
                    console.log('[perf] 5s delta', snapshot);
                    if (Object.keys(stateDiff).length) {
                        console.log('[perf] state changes', stateDiff);
                    }
                }, 5000);
                return () => window.clearInterval(interval);
            }, [perfEnabled]);

            useEffect(() => {
                if (!perfEnabled) return;
                const snapshot = {
                    activeGroupId,
                    selectedSprint,
                    selectedTeams: (selectedTeams || []).join('|'),
                    selectedTasksCount: Object.keys(selectedTasks || {}).length,
                    searchQuery,
                    searchInput,
                    showPlanning,
                    showStats,
                    showScenario,
                    showDependencies: true,
                    engStatusFilter,
                    loading,
                    sprintsLoading,
                    groupsLoading,
                    tasksFetched,
                    techLoaded,
                    showBackToTop,
                    planningOffset,
                    showGroupDropdown,
                    showTeamDropdown,
                    showSprintDropdown,
                    showGroupManage,
                    groupSaving,
                    sprintSearch,
                    priorityHoverIndex
                };
                const prev = perfStateRef.current || {};
                const counts = perfStateCountsRef.current || {};
                Object.keys(snapshot).forEach((key) => {
                    if (prev[key] !== snapshot[key]) {
                        counts[key] = (counts[key] || 0) + 1;
                    }
                });
                perfStateCountsRef.current = counts;
                perfStateRef.current = snapshot;
            }, [
                perfEnabled,
                activeGroupId,
                selectedSprint,
                selectedTeams,
                selectedTasks,
                searchQuery,
                searchInput,
                showPlanning,
                showStats,
                showScenario,
                showDependencies,
                engStatusFilter,
                loading,
                sprintsLoading,
                groupsLoading,
                tasksFetched,
                techLoaded,
                showBackToTop,
                planningOffset,
                showGroupDropdown,
                showTeamDropdown,
                showSprintDropdown,
                showGroupManage,
                groupSaving,
                sprintSearch,
                priorityHoverIndex
            ]);

            const normalizeStatus = (status) => {
                return (status || '').toLowerCase().replace(/\s+/g, ' ').trim();
            };
            const normalizeEpicKey = (value) => {
                const normalized = String(value || '').trim().toUpperCase();
                return normalized || 'NO_EPIC';
            };
            const isBurnoutClosedStatus = React.useCallback((status) => {
                const normalized = (status || '').toLowerCase().replace(/\s+/g, ' ').trim();
                return normalized === 'done' || normalized === 'killed' || normalized === 'incomplete';
            }, []);


            useEpmSavedSubGoalsEffect({
                epmConfigLoaded,
                loadEpmSubGoalsForRoot,
                savedEpmRootGoalKey,
                savedEpmSubGoalKeys,
                selectedView,
                showEpmNavigation,
            });
            const {
                epmTab,
                setEpmTab,
                setEpmProjects,
                epmProjectsLoading,
                setEpmProjectsError,
                epmSelectedProjectId,
                setEpmSelectedProjectId,
                visibleEpmProjects,
                selectedEpmProject,
                filteredEpmProjects,
                visibleEpmRollupBoards,
                epmRollupTree,
                epmRollupBoards,
                epmDuplicates,
                epmAggregateTruncated,
                epmRollupLoading,
                epmProjectRollupLoadingIds,
                epmSelectedSubGoalKeys,
                setEpmSelectedSubGoalKeys,
                runtimeEpmSubGoalKeys,
                refreshEpmProjects,
                refreshEpmView,
                loadArchivedEpmProjectRollup,
            } = useEpmViewData({
                backendUrl: BACKEND_URL,
                initialEpmTab: savedPrefsRef.current.epmTab ?? 'active',
                initialEpmSelectedProjectId: savedPrefsRef.current.epmSelectedProjectId ?? '',
                selectedView: showEpmNavigation ? selectedView : 'eng',
                epmConfigLoaded,
                hasSavedEpmScope,
                savedEpmSubGoalKeys,
                selectedSprint,
                epmProjectSearch,
                epmProjectSort,
                searchQuery,
                onHomeTokenRequired: markHomeTokenRequired,
                onServerConnectionFailure: reportServerConnectionError,
            });
            const [epmCollapsedProjectIds, setEpmCollapsedProjectIds] = useState(() => new Set());
            const epmVisibleProjectKeys = React.useMemo(() => {
                if (selectedView !== 'epm' || epmSelectedProjectId) return [];
                const boards = Array.isArray(visibleEpmRollupBoards) ? visibleEpmRollupBoards : [];
                return boards
                    .map(({ project }) => project?.id || getEpmProjectDisplayName(project) || '')
                    .filter(Boolean);
            }, [selectedView, epmSelectedProjectId, visibleEpmRollupBoards]);
            const epmVisibleProjectKeysSignature = epmVisibleProjectKeys.join('|');
            const showEpmProjectCollapseAllButton = selectedView === 'epm' && !epmSelectedProjectId && epmVisibleProjectKeys.length > 1;
            const allVisibleEpmProjectsCollapsed = epmVisibleProjectKeys.length > 0 && epmVisibleProjectKeys.every((key) => epmCollapsedProjectIds.has(key));
            const epmProjectCollapseAllLabel = allVisibleEpmProjectsCollapsed ? 'Expand all projects' : 'Collapse all projects';

            useEffect(() => {
                if (selectedView !== 'epm' || epmSelectedProjectId || !Array.isArray(visibleEpmRollupBoards)) return;
                setEpmCollapsedProjectIds((prev) => {
                    const next = new Set(prev);
                    epmVisibleProjectKeys.forEach((key) => next.add(key));
                    return next;
                });
            }, [selectedView, epmSelectedProjectId, epmTab, epmVisibleProjectKeysSignature]);

            const toggleAllVisibleEpmProjectsCollapsed = () => {
                if (!showEpmProjectCollapseAllButton) return;
                if (allVisibleEpmProjectsCollapsed) {
                    setEpmCollapsedProjectIds((prev) => {
                        const next = new Set(prev);
                        epmVisibleProjectKeys.forEach((key) => next.delete(key));
                        return next;
                    });
                    if (epmTab === 'archived') {
                        (visibleEpmRollupBoards || []).forEach(({ project }) => loadArchivedEpmProjectRollup(project));
                    }
                    return;
                }
                setEpmCollapsedProjectIds((prev) => {
                    const next = new Set(prev);
                    epmVisibleProjectKeys.forEach((key) => next.add(key));
                    return next;
                });
            };

            useEpmSettingsProjectsEffects({
                canLoadEpmProjects,
                ensureEpmSettingsProjectsLoaded,
                epmConfigDraft,
                epmSettingsProjectsCacheKey,
                epmSettingsProjectsCacheRef,
                epmSettingsTab,
                groupManageTab,
                normalizeEpmConfigDraft,
                setEpmSettingsProjectsFetchMeta,
                setEpmSettingsProjectsLoaded,
                setEpmSettingsProjectsLoadedAt,
                showGroupManage,
            });

            const {
                applySharedConfigBootstrap,
                discardMineOnGroupsConfigConflict,
                groupConfigValidationErrors,
                isGroupDraftDirty,
                keepMineOnGroupsConfigConflict,
                keepMineOnWorkspaceConfigConflict,
                returnFromFirstRunConfigurationRecovery,
                saveAllSettings,
                saveBlockedReason,
                unsavedSectionsCount,
                useLatestWorkspaceConfig,
            } = useSharedConfigSave({
                BACKEND_URL,
                acceptedBoardConfigRef,
                acceptedGroupsConfigRef,
                activeGroupId,
                adminAccess,
                anyFieldConfigDirty,
                applyAdminSettingsGateConfig,
                applyCapacityLoaded,
                applyJiraIssueTypesLoaded,
                applyJiraProjectsAndBoardLoaded,
                applyPriorityWeightsLoaded,
                applySavePermissions,
                applySavedEpmConfig,
                applySavedGroupsConfig,
                authMode,
                boardConfigReadGenerationRef,
                boardConfigSaveReadFenceRef,
                canEditEpmConfiguration,
                canEditSharedConfiguration,
                capacityFieldIdDraft,
                capacityProjectDraft,
                commitSharedConfigRevision,
                dirtyFieldConfigCount,
                dispatchFirstRunConfigurationSession,
                epmConfigLoading,
                epmConfigSaving,
                favoriteGroupValidationError,
                firstRunConfigurationActive,
                firstRunConfigurationSession,
                getActiveDepartmentSettingsTab: () => activeDepartmentSettingsTab,
                getCloseGroupManage: () => closeGroupManage,
                getLoadConfig: () => loadConfig,
                getLoadSprints: () => loadSprints,
                groupDraft,
                groupDraftBaselineRef,
                groupDraftSignature,
                groupManageTab,
                groupSaving,
                groupStateRef,
                groupsConfig,
                groupsConfigConflict,
                groupsReadGenerationRef,
                groupsSaveReadFenceRef,
                invalidateSprintDataForConfigSave,
                invalidateTeamMembership,
                isBoardConfigDirty,
                isCapacityDraftDirty,
                isDeliveryOwnerFieldDirty,
                isEpmConfigDirty,
                isGroupVisibilityDraftDirty,
                isIssueTypesDraftDirty,
                isParentNameFieldDirty,
                isPriorityWeightsDirty,
                isProjectsDraftDirty,
                isSprintFieldDirty,
                isStoryPointsFieldDirty,
                isTeamFieldDirty,
                parentNameFieldIdDraft,
                persistGroupPreferences,
                priorityWeightsValidationError,
                queueConfigSaveRefresh,
                saveBoardConfig,
                saveCapacityConfig,
                saveDeliveryOwnerFieldConfig,
                saveEpmConfig,
                saveFirstRunGroupPreferences,
                saveIssueTypesConfig,
                saveParentNameFieldConfig,
                savePriorityWeightsConfig,
                saveProjectSelection,
                saveSprintFieldConfig,
                saveStoryPointsFieldConfig,
                saveTeamFieldConfig,
                seedSharedFieldConfigs,
                selectedProjectsDraft,
                selectedSprint,
                setActiveGroupDraftId,
                setAuthMode,
                setBoardAllWorkAvailable,
                setBoardBootstrapStatus,
                setBoardGroupsReadFailed,
                setBoardIdDraft,
                setBoardNameDraft,
                setCapacityEnabled,
                setCapacityFieldIdDraft,
                setCapacityFieldNameDraft,
                setCapacityProjectDraft,
                setDeliveryOwnerFieldIdDraft,
                setDeliveryOwnerFieldNameDraft,
                setEpmConfigDraft,
                setGroupDraft,
                setGroupDraftError,
                setGroupManageTab,
                setGroupPreferences,
                setGroupPreferencesSaving,
                setGroupSaving,
                setGroupsConfigConflict,
                setGroupsError,
                setGroupsLoading,
                setIssueTypesDraft,
                setParentNameFieldIdDraft,
                setParentNameFieldNameDraft,
                setPriorityWeightsDraft,
                setSelectedProjectsDraft,
                setSettingsSaveError,
                setSharedConfigReady,
                setSharedConfigRevision,
                setSprintFieldIdDraft,
                setSprintFieldNameDraft,
                setStoryPointsFieldIdDraft,
                setStoryPointsFieldNameDraft,
                setTeamFieldIdDraft,
                setTeamFieldNameDraft,
                setWorkspaceConfigConflict,
                sharedConfigReady,
                sharedConfigRevisionRef,
                showScenario,
                sprintCatalogControllerRef,
                sprintFieldIdDraft,
                storyPointsFieldIdDraft,
                teamFieldIdDraft,
                trackSettingsAction,
                workspaceConfigConflict,
            });
            const {
                activeDepartmentSettingsTab,
                activeSettingsModalTab,
                closeGroupManage,
                discardGroupDraftChanges,
                handleAdminSettingsTabKeyDown,
                handleDepartmentSettingsTabKeyDown,
                labelsTabEnabled,
                openBoardAdminScopeSettings,
                openBoardDepartmentSettings,
                openGroupManage,
                requestCloseGroupManage,
                selectAdminSettingsTab,
                selectDepartmentSettingsTab,
                settingsModalTabs,
                settingsSaveDisabled,
                settingsSaveHandler,
                settingsSaveLabel,
                settingsSaveTitle,
                settingsShowsSave,
                testGroupsConfigConnection,
            } = useSettingsModal({
                BACKEND_URL,
                adminAccessAvailable,
                adminSettingsTab,
                canEditEpmConfiguration,
                canEditSharedConfiguration,
                departmentSettingsTab,
                epmConfigBaselineRef,
                epmConfigSaving,
                firstRunConfigurationActive,
                firstRunConfigurationSession,
                groupDraft,
                groupManageTab,
                groupPreferences,
                groupSaving,
                groupsConfig,
                isEpmConfigDirty,
                isGroupDraftDirty,
                openEpmSettingsTab,
                performanceAdminAvailable,
                preferredSettingsTab,
                saveAllSettings,
                saveBlockedReason,
                setAdminSettingsTab,
                setBoardSearchIndex,
                setBoardSearchOpen,
                setBoardSearchQuery,
                setCapacityFieldSearchOpen,
                setCapacityFieldSearchQuery,
                setCapacityProjectSearchOpen,
                setCapacityProjectSearchQuery,
                setComponentSearchIndex,
                setComponentSearchOpen,
                setComponentSearchQuery,
                setDepartmentSettingsTab,
                setEpmConfigDraft,
                setExcludedEpicSearchIndex,
                setExcludedEpicSearchOpen,
                setExcludedEpicSearchQuery,
                setGroupDraftError,
                setGroupImportText,
                setGroupManageTab,
                setGroupTestMessage,
                setGroupTesting,
                setGroupsConfigConflict,
                setProjectSearchIndex,
                setProjectSearchOpen,
                setProjectSearchQuery,
                setSettingsSaveError,
                setShowGroupAdvanced,
                setShowGroupDiscardConfirm,
                setShowGroupImport,
                setShowGroupListMobile,
                setShowGroupManage,
                trackSettingsAction,
                userCanEditSettings,
            });
            const onboardingActiveSurface = showGroupManage
                ? 'settings'
                : (selectedView === 'eng'
                    ? deriveActiveEngMode({ showScenario, showStats, showPlanning, showBoard })
                    : selectedView);
            const onboardingBootstrapReady = groupsLoading === false
                && !groupsError
                && !serverConnectionError
                && onboardingAvailable
                && groupPreferences.onboardingRequired === false;
            const canStartOnboardingModule = React.useCallback(
                () => onboardingBootstrapReady && !isDashboardMobileViewport(),
                [onboardingBootstrapReady],
            );
            const onboarding = useOnboardingController({
                bootstrapReady: onboardingBootstrapReady,
                activeSurface: onboardingActiveSurface,
                completedModules: groupPreferences.completedOnboardingModules,
                setCompletedModules: (settlement) => setGroupPreferences((current) => ({
                    ...current,
                    completedOnboardingModules: settlement.completedModules,
                    onboardingDone: settlement.onboardingDone,
                })),
                completeModule: (moduleId) => requestCompleteOnboardingModule(BACKEND_URL, moduleId),
                resetModules: () => requestResetOnboardingModules(BACKEND_URL),
                prepareCatchUp: () => {
                    setSelectedView('eng');
                    setShowPlanning(false);
                    setShowStats(false);
                    setShowScenario(false);
                    setShowBoard(false);
                },
                closeSettings: closeGroupManage,
                trackSettingsAction,
                canStartModule: canStartOnboardingModule,
            });
            const onboardingReplayDisabled = Boolean(
                isGroupDraftDirty
                || groupSaving
                || epmConfigSaving
                || groupVisibilitySaving
                || onboarding.pending
            );



            const updateNoticeVisible = React.useMemo(() => {
                if (!updateInfo || updateInfo.enabled === false) return false;
                if (!updateInfo.updateAvailable) return false;
                const remoteHash = updateInfo?.remote?.hash;
                if (!remoteHash) return false;
                return remoteHash !== updateDismissedHash;
            }, [updateInfo, updateDismissedHash]);
            const dismissUpdateNotice = () => {
                const remoteHash = updateInfo?.remote?.hash;
                if (remoteHash) {
                    setUpdateDismissedHash(remoteHash);
                }
                setShowUpdateModal(false);
            };




            useSettingsHotkeyEffect({
                closeAllTeamSearchDropdowns,
                epmConfigSaving,
                firstRunConfigurationActive,
                firstRunConfigurationSession,
                groupManageTab,
                groupSaving,
                requestCloseGroupManage,
                saveAllSettings,
                setShowGroupDiscardConfirm,
                showGroupDiscardConfirm,
                showGroupManage,
                teamSearchOpen,
            });

            useJiraProjectSearchEffects({
                BACKEND_URL,
                boardIdDraft,
                boardSearchQuery,
                groupManageTab,
                projectSearchQuery,
                setBoardSearchRemoteLoading,
                setBoardSearchRemoteResults,
                setProjectSearchRemoteLoading,
                setProjectSearchRemoteResults,
                showGroupManage,
            });

            useTeamGroupSearchEffects({
                BACKEND_URL,
                adHocEpicSearchIndex,
                adHocEpicSearchQuery,
                componentSearchIndex,
                componentSearchQuery,
                excludedEpicSearchIndex,
                excludedEpicSearchQuery,
                filteredAdHocEpicSearchResults,
                filteredComponentSearchResults,
                filteredExcludedEpicSearchResults,
                groupManageTab,
                setAdHocEpicSearchIndex,
                setAdHocEpicSearchLoading,
                setAdHocEpicSearchResults,
                setComponentSearchIndex,
                setComponentSearchLoading,
                setComponentSearchResults,
                setExcludedEpicSearchIndex,
                setExcludedEpicSearchLoading,
                setExcludedEpicSearchResults,
                showGroupManage,
            });

            useJiraProjectCatalogEffects({
                boardSearchIndex,
                boardSearchResults,
                fetchJiraFields,
                issueTypeSearchIndex,
                issueTypeSearchResults,
                projectSearchIndex,
                projectSearchResults,
                setBoardSearchIndex,
                setIssueTypeSearchIndex,
                setProjectSearchIndex,
                showGroupManage,
            });

            useCapacityMappingEffects({
                capacityFieldSearchIndex,
                capacityFieldSearchResults,
                capacityProjectSearchIndex,
                capacityProjectSearchResults,
                setCapacityFieldSearchIndex,
                setCapacityProjectSearchIndex,
            });

            useSettingsTabGuardEffects({
                canEditEpmConfiguration,
                canEditSharedConfiguration,
                groupManageTab,
                setAdminSettingsTab,
                setDepartmentSettingsTab,
                setGroupManageTab,
                showGroupManage,
            });

            useTeamGroupLabelEffects({
                activeGroupDraft,
                activeTeamAvailabilityKey,
                activeTeamResultsLimited,
                labelSearchDebounceRef,
                setTeamSearchIndex,
            });



            const registerSprintFetch = () => {
                const controller = new AbortController();
                sprintFetchControllersRef.current.add(controller);
                return controller;
            };

            const cleanupSprintFetch = (controller) => {
                if (!controller) return;
                sprintFetchControllersRef.current.delete(controller);
            };

            const activeGroup = React.useMemo(() => {
                return (visibleControlGroups || []).find(group => group.id === activeGroupId) || null;
            }, [visibleControlGroups, activeGroupId]);
            const activeGroupTeamLabels = React.useMemo(() => {
                return activeGroup?.teamLabels || {};
            }, [activeGroup]);

            const activeGroupTeamIds = React.useMemo(() => {
                const seen = new Set();
                const ids = [];
                (activeGroup?.teamIds || []).forEach(teamId => {
                    const value = String(teamId || '').trim();
                    if (!value || seen.has(value)) return;
                    seen.add(value);
                    ids.push(value);
                });
                return ids;
            }, [activeGroup]);
            const sprintCatalogReady = sprintCatalogState.authority === 'validated'
                && availableSprints.length > 0
                && availableSprints.some(sprint => String(sprint.id) === String(selectedSprint));
            const engSprintSelectorState = React.useMemo(() => resolveEngSprintSelectorState({
                boardMode: selectedView === 'eng' && showBoard,
                catalogReady: sprintCatalogReady,
                bootstrapStatus: boardBootstrapStatus,
                capability: boardAllWorkAvailable,
                groupsLoading,
                groupsFailed: boardGroupsReadFailed,
                group: activeGroup,
                savedProjects: savedSelectedProjects,
                savedBoardId,
            }), [
                selectedView, showBoard, sprintCatalogReady, boardBootstrapStatus,
                boardAllWorkAvailable, groupsLoading, boardGroupsReadFailed, activeGroup,
                savedSelectedProjects, savedBoardId,
            ]);
            const selectedScopeReadiness = boardStrictScope === 'component'
                ? engSprintSelectorState.componentReadiness
                : boardStrictScope === 'all_work'
                    ? engSprintSelectorState.allWorkReadiness
                    : 'ready';
            const strictBoardActive = boardScopeRequested && selectedScopeReadiness === 'ready';
            const acceptedEngSprintSelectorState = React.useMemo(() => resolveEngSprintSelectorState({
                boardMode: selectedView === 'eng' && showBoard,
                catalogReady: sprintCatalogReady,
                bootstrapStatus: acceptedBoardConfigRef.current ? 'ready' : boardBootstrapStatus,
                capability: boardAllWorkAvailable,
                groupsLoading: acceptedGroupsConfigRef.current ? false : groupsLoading,
                groupsFailed: acceptedGroupsConfigRef.current ? false : boardGroupsReadFailed,
                group: activeGroup,
                savedProjects: savedSelectedProjects,
                savedBoardId,
            }), [
                selectedView, showBoard, sprintCatalogReady, boardBootstrapStatus,
                boardAllWorkAvailable, groupsLoading, boardGroupsReadFailed, activeGroup,
                savedSelectedProjects, savedBoardId,
            ]);
            const acceptedSelectedScopeReadiness = boardStrictScope === 'component'
                ? acceptedEngSprintSelectorState.componentReadiness
                : boardStrictScope === 'all_work'
                    ? acceptedEngSprintSelectorState.allWorkReadiness
                    : 'ready';
            const strictBoardOwnerActive = boardScopeRequested && acceptedSelectedScopeReadiness === 'ready';
            const acceptedStrictBoardRevision = React.useMemo(() => JSON.stringify(stableAcceptedConfigValue({
                workspaceConfigRevision: sharedConfigRevision,
                departmentConfigRevision: groupsConfig.configRevision,
                department: activeGroup ? {
                    id: String(activeGroup.id || ''),
                    boardColumns: activeGroup.board?.columns || [],
                    components: [...new Set((activeGroup.missingInfoComponents || [])
                        .map(value => String(value || '').trim()).filter(Boolean))].sort(),
                    teams: [...activeGroupTeamIds].sort(),
                } : null,
                jiraAuthority: {
                    projects: (savedSelectedProjects || [])
                        .map(project => ({
                            key: String(project?.key || '').trim().toUpperCase(),
                            type: String(project?.type || '').trim(),
                        }))
                        .filter(project => project.key)
                        .sort((left, right) => left.key.localeCompare(right.key) || left.type.localeCompare(right.type)),
                    sourceBoardId: String(savedBoardId || '').trim(),
                },
            })), [
                sharedConfigRevision, groupsConfig.configRevision, activeGroup, activeGroupTeamIds,
                savedSelectedProjects, savedBoardId,
            ]);
            const statsTeamColorMap = React.useMemo(() => buildTeamColorMap(
                activeGroupTeamIds.map((teamId) => ({ id: teamId, name: resolveTeamName(teamId) }))
            ), [activeGroupTeamIds, teamNameLookup]);
            const resolveStatsTeamColor = React.useCallback(
                (teamId) => resolveTeamColor(teamId, statsTeamColorMap),
                [statsTeamColorMap]
            );
            const activeGroupMissingComponents = React.useMemo(() => {
                const seen = new Set();
                const names = [];
                (activeGroup?.missingInfoComponents || []).forEach((componentName) => {
                    const value = String(componentName || '').trim();
                    if (!value || seen.has(value)) return;
                    seen.add(value);
                    names.push(value);
                });
                return names;
            }, [activeGroup]);
            const activeGroupExcludedCapacityEpics = React.useMemo(() => {
                const seen = new Set();
                const keys = [];
                (activeGroup?.excludedCapacityEpics || []).forEach((epicKey) => {
                    const value = String(epicKey || '').trim().toUpperCase();
                    if (!value || seen.has(value)) return;
                    seen.add(value);
                    keys.push(value);
                });
                return keys;
            }, [activeGroup]);
            const activeGroupAdHocCapacityEpics = React.useMemo(() => {
                const seen = new Set();
                const keys = [];
                (activeGroup?.adHocCapacityEpics || []).forEach((epicKey) => {
                    const value = String(epicKey || '').trim().toUpperCase();
                    if (!value || seen.has(value)) return;
                    seen.add(value);
                    keys.push(value);
                });
                return keys;
            }, [activeGroup]);

            const activeGroupTeamSet = React.useMemo(() => new Set(activeGroupTeamIds), [activeGroupTeamIds]);
            const planningScopeKey = React.useMemo(() => {
                if (selectedSprint === null || !activeGroupId) return '';
                return buildPlanningScopeKey({ sprintId: selectedSprint, groupId: activeGroupId });
            }, [selectedSprint, activeGroupId]);
            const teamSelectionScopeKey = React.useMemo(() => {
                if (selectedSprint === null || !activeGroupId) return '';
                return buildTeamSelectionScopeKey({ sprintId: selectedSprint, groupId: activeGroupId });
            }, [selectedSprint, activeGroupId]);
            authResumeSnapshotRef.current = {
                principal: authResumePrincipalRef.current,
                view: {
                    selectedView,
                    activeGroupId,
                    selectedSprint: selectedSprint === null ? '' : String(selectedSprint),
                    engMode: showPlanning ? 'planning' : showStats ? 'statistics' : showScenario ? 'scenario' : showBoard ? 'board' : 'catch-up',
                    settingsOpen: showGroupManage,
                    settingsTab: groupManageTab,
                },
                planning: {
                    scopeKey: planningScopeKey,
                    selectedTaskKeys: selectedTaskKeysFromMap(selectedTasks),
                    selectedTeams: normalizeSelectedTeams(selectedTeams),
                    selectionMode: planningSelectionMode,
                },
            };
            useEffect(() => {
                const captureAuthResume = () => {
                    const principal = authResumePrincipalRef.current;
                    const tabStorage = getAuthResumeStorage(window);
                    if (!tabStorage || !principal?.workspaceId || !principal?.viewConfigId) return;
                    writeAuthResumeState(tabStorage, authResumeSnapshotRef.current);
                };
                window.addEventListener(AUTH_REQUIRED_EVENT, captureAuthResume);
                if (readPendingAuthenticationRequired()) captureAuthResume();
                return () => window.removeEventListener(AUTH_REQUIRED_EVENT, captureAuthResume);
            }, []);
            useEffect(() => {
                const resume = pendingShellAuthResumeRef.current;
                const settled = authResumeShellSettledRef.current;
                if (!resume || !settled || settled.has('group') || groupsLoading) return;
                const requestedGroup = String(resume.activeGroupId || '');
                const groupAvailable = requestedGroup && visibleControlGroups.some(group => String(group.id) === requestedGroup);
                if (groupAvailable) setActiveGroupId(requestedGroup);
                settled.add('group');
            }, [groupsLoading, visibleControlGroups, activeGroupId, authResumeStagedRevision]);
            useEffect(() => {
                const resume = pendingShellAuthResumeRef.current;
                const settled = authResumeShellSettledRef.current;
                if (!resume || !settled || settled.has('sprint') || sprintsLoading) return;
                const requestedSprint = availableSprints.find(sprint => String(sprint.id) === resume.selectedSprint);
                if (requestedSprint) {
                    setSelectedSprint(requestedSprint.id);
                    setSprintName(requestedSprint.name);
                }
                settled.add('sprint');
            }, [sprintsLoading, availableSprints, selectedSprint, authResumeStagedRevision]);
            const buildDefaultGroupState = (groupId) => {
                const hasStoredPlanningState = planningScopeKey
                    ? hasPlanningState(window.localStorage, planningScopeKey)
                    : false;
                const planningState = planningScopeKey
                    ? loadPlanningState(window.localStorage, planningScopeKey)
                    : null;
                const selectionModeFromPlanning = hasStoredPlanningState
                    ? (planningState?.selectionMode || PLANNING_SELECTION_MODE_MANUAL)
                    : (isFutureSprintSelected ? PLANNING_SELECTION_MODE_DEFAULT_ALL : PLANNING_SELECTION_MODE_MANUAL);
                const storedTeamSelectionState = teamSelectionScopeKey
                    ? loadTeamSelectionState(window.localStorage, teamSelectionScopeKey)
                    : null;
                const liveTeamSelection = storedTeamSelectionState
                    ? resolveTeamSelectionHydrationState({
                        storedState: storedTeamSelectionState,
                        savedPrefsSelectedTeams: savedPrefsRef.current.selectedTeams,
                        savedPrefsSelectedTeam: savedPrefsRef.current.selectedTeam
                    }).selectedTeams
                    : selectedTeams;
                const selectedTeamsFromPlanning = resolvePlanningTeamSelection({
                    scopedState: hasStoredPlanningState ? planningState : null,
                    liveSelectedTeams: liveTeamSelection,
                    savedPrefsSelectedTeams: savedPrefsRef.current.selectedTeams,
                    savedPrefsSelectedTeam: savedPrefsRef.current.selectedTeam
                });
                const selectedTasksFromPlanning = hasStoredPlanningState
                    ? selectedTaskMapFromKeys(planningState?.selectedTaskKeys || [])
                    : {};
                return {
                    sprintId: selectedSprint,
                    planningScopeKey,
                    teamIdsSignature: activeGroupTeamIds.join('|'),
                    productTasks: [],
                    techTasks: [],
                    loadedProductTasks: [],
                    loadedTechTasks: [],
                    tasksFetched: false,
                    readyToCloseProductTasks: [],
                    readyToCloseTechTasks: [],
                    missingPlanningInfoTasks: [],
                    missingInfoEpics: [], backlogProductEpics: [], backlogTechEpics: [],
                    productEpicsInScope: [],
                    techEpicsInScope: [],
                    readyToCloseProductEpicsInScope: [],
                    readyToCloseTechEpicsInScope: [],
                    techLoaded: false,
                    error: '',
                    engStatusFilter: initialEngFilters.status,
                    engPriorityFilter: initialEngFilters.priority, engProjectTrackFilter: undefined,
                    showTech: savedPrefsRef.current.showTech ?? true,
                    showProduct: savedPrefsRef.current.showProduct ?? true,
                    groupByInitiativeChoice: savedPrefsRef.current.groupByInitiativeChoice ?? null,
                    selectedTeams: selectedTeamsFromPlanning,
                    selectedTasks: selectedTasksFromPlanning,
                    planningSelectionMode: selectionModeFromPlanning,
                    showPlanning,
                    showStats,
                    showScenario,
                    showBoard,
                    boardView: null,
                    engBoardFilterSelection: {},
                    showDependencies: true,
                    epicDetails: {},
                    statsView: resolveStatsView(savedPrefsRef.current.statsView),
                    statsGraphMode: resolveStatsGraphMode(savedPrefsRef.current.statsGraphMode),
                    burnoutData: null,
                    burnoutLoading: false,
                    burnoutError: '',
                    burnoutAssigneeFilter: savedPrefsRef.current.burnoutAssigneeFilter || 'all',
                    burndownMetric: resolveBurndownMetric(savedPrefsRef.current.burndownMetric),
                    cohortData: null,
                    cohortLoading: false,
                    cohortError: '',
                    cohortStartQuarter: savedPrefsRef.current.cohortStartQuarter || getCurrentQuarterLabel(),
                    cohortEndQuarter: savedPrefsRef.current.cohortEndQuarter || getCurrentQuarterLabel(),
                    cohortGroupBy: resolveCohortGroupBy(savedPrefsRef.current.cohortGroupBy),
                    cohortProjectFilter: savedPrefsRef.current.cohortProjectFilter || 'all',
                    cohortAssigneeFilter: savedPrefsRef.current.cohortAssigneeFilter || 'all',
                    cohortExcludeAdHoc: Boolean(savedPrefsRef.current.cohortExcludeAdHoc),
                    cohortExcludeCapacity: savedPrefsRef.current.cohortExcludeCapacity ?? true,
                    cohortStatusToggles: {
                        done: true,
                        open: true,
                        killed: false,
                        incomplete: false,
                        postponed: false,
                        ...(savedPrefsRef.current.cohortStatusToggles || {})
                    },
                    cohortSelectedRow: null,
                    ...buildDefaultScenarioGroupState(savedPrefsRef.current.scenarioLaneMode),
                    hideExcludedStats: savedPrefsRef.current.hideExcludedStats ?? true,
                    showMissingAlert: savedPrefsRef.current.showMissingAlert ?? true,
                    showBlockedAlert: savedPrefsRef.current.showBlockedAlert ?? true,
                    showPostponedAlert: savedPrefsRef.current.showPostponedAlert ?? true,
                    showBacklogAlert: savedPrefsRef.current.showBacklogAlert ?? true,
                    showMissingTeamAlert: savedPrefsRef.current.showMissingTeamAlert ?? true,
                    showMissingLabelsAlert: savedPrefsRef.current.showMissingLabelsAlert ?? true,
                    showNeedsStoriesAlert: savedPrefsRef.current.showNeedsStoriesAlert ?? savedPrefsRef.current.showCreateStoriesAlert ?? savedPrefsRef.current.showWaitingAlert ?? true,
                    showWaitingAlert: savedPrefsRef.current.showWaitingAlert ?? true,
                    showEmptyEpicAlert: savedPrefsRef.current.showEmptyEpicAlert ?? true,
                    showDoneEpicAlert: savedPrefsRef.current.showDoneEpicAlert ?? true,
                    showAlertsPanel: savedPrefsRef.current.showAlertsPanel ?? true,
                    dismissedAlertKeys: [],
                    dependencyData: {},
                    dependencyFocus: null,
                    dependencyLookupCache: {},
                    dependencyLookupLoading: false
                };
            };

            const buildGroupStateSnapshot = () => ({
                sprintId: selectedSprint,
                planningScopeKey,
                teamIdsSignature: activeGroupTeamIds.join('|'),
                productTasks,
                techTasks,
                loadedProductTasks,
                loadedTechTasks,
                tasksFetched,
                readyToCloseProductTasks,
                readyToCloseTechTasks,
                missingPlanningInfoTasks,
                missingInfoEpics, backlogProductEpics, backlogTechEpics,
                productEpicsInScope,
                techEpicsInScope,
                readyToCloseProductEpicsInScope,
                readyToCloseTechEpicsInScope,
                techLoaded,
                error,
                engStatusFilter,
                engPriorityFilter, engProjectTrackFilter,
                showTech,
                showProduct,
                groupByInitiativeChoice,
                selectedTeams,
                selectedTasks,
                planningSelectionMode,
                showPlanning,
                showStats,
                showScenario,
                showBoard,
                boardView,
                engBoardFilterSelection,
                showDependencies,
                epicDetails,
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
                ...scenarioGroupValues,
                hideExcludedStats,
                showMissingAlert,
                showBlockedAlert,
                showPostponedAlert,
                showBacklogAlert,
                showMissingTeamAlert,
                showMissingLabelsAlert,
                showNeedsStoriesAlert,
                showWaitingAlert,
                showEmptyEpicAlert,
                showDoneEpicAlert,
                showAlertsPanel,
                dismissedAlertKeys,
                dependencyData,
                dependencyFocus,
                dependencyLookupCache,
                dependencyLookupLoading
            });

            const applyGroupState = (state) => {
                const nextState = state || buildDefaultGroupState(activeGroupId);
                restoringGroupRef.current = true;
                resetScenarioTransientRefs({ scenarioIssueRefMap, scenarioEdgeUpdatePendingRef, scenarioFocusRestoreRef, scenarioSkipAutoCollapseRef, scenarioTeamCollapseInitRef, scenarioEdgeFrameRef, scenarioScrollFrameRef, scenarioResizeFrameRef, scenarioPendingScrollRef });
                alertDismissedRef.current = false;
                epicRefMap.current = new Map();
                setProductTasks(nextState.productTasks || []);
                setTechTasks(nextState.techTasks || []);
                setLoadedProductTasks(nextState.loadedProductTasks || []);
                setLoadedTechTasks(nextState.loadedTechTasks || []);
                setTasksFetched(Boolean(nextState.tasksFetched));
                setReadyToCloseProductTasks(nextState.readyToCloseProductTasks || []);
                setReadyToCloseTechTasks(nextState.readyToCloseTechTasks || []);
                setMissingPlanningInfoTasks(nextState.missingPlanningInfoTasks || []);
                setMissingInfoEpics(nextState.missingInfoEpics || []); setBacklogProductEpics(nextState.backlogProductEpics || []); setBacklogTechEpics(nextState.backlogTechEpics || []);
                setProductEpicsInScope(nextState.productEpicsInScope || []);
                setTechEpicsInScope(nextState.techEpicsInScope || []);
                setReadyToCloseProductEpicsInScope(nextState.readyToCloseProductEpicsInScope || []);
                setReadyToCloseTechEpicsInScope(nextState.readyToCloseTechEpicsInScope || []);
                setTechLoaded(Boolean(nextState.techLoaded));
                setError(nextState.error || '');
                setEngStatusFilter(nextState.engStatusFilter ?? null);
                setEngPriorityFilter(nextState.engPriorityFilter ?? null); setEngProjectTrackFilter(Array.isArray(nextState.engProjectTrackFilter) ? nextState.engProjectTrackFilter : undefined);
                setShowTech(nextState.showTech ?? true);
                setShowProduct(nextState.showProduct ?? true);
                setGroupByInitiativeChoice(nextState.groupByInitiativeChoice ?? null);
                setSelectedTeams(normalizeSelectedTeams(nextState.selectedTeams));
                setSelectedTasks(nextState.selectedTasks || {});
                setPlanningSelectionMode(nextState.planningSelectionMode || PLANNING_SELECTION_MODE_MANUAL);
                setCanUndoPlanningSelection(false);
                setShowPlanning(nextState.showPlanning ?? false);
                setShowStats(nextState.showStats ?? false);
                setShowScenario(nextState.showScenario ?? false);
                setShowBoard(nextState.showBoard ?? false);
                setBoardView(nextState.boardView ?? null);
                setEngBoardFilterSelection(nextState.engBoardFilterSelection ?? {});
                setShowDependencies(true);
                setEpicDetails(nextState.epicDetails || {});
                setStatsView(resolveStatsView(nextState.statsView));
                setStatsGraphMode(resolveStatsGraphMode(nextState.statsGraphMode));
                setBurnoutData(nextState.burnoutData || null);
                setBurnoutLoading(false);
                setBurnoutError(nextState.burnoutError || '');
                setBurnoutAssigneeFilter(nextState.burnoutAssigneeFilter || 'all');
                setBurndownMetric(resolveBurndownMetric(nextState.burndownMetric));
                setCohortData(nextState.cohortData || null);
                setCohortLoading(false);
                setCohortError(nextState.cohortError || '');
                setCohortStartQuarter(nextState.cohortStartQuarter || getCurrentQuarterLabel());
                setCohortEndQuarter(nextState.cohortEndQuarter || getCurrentQuarterLabel());
                setCohortGroupBy(resolveCohortGroupBy(nextState.cohortGroupBy));
                setCohortProjectFilter(nextState.cohortProjectFilter || 'all');
                setCohortAssigneeFilter(nextState.cohortAssigneeFilter || 'all');
                setCohortExcludeAdHoc(Boolean(nextState.cohortExcludeAdHoc));
                setCohortExcludeCapacity(nextState.cohortExcludeCapacity ?? true);
                setCohortStatusToggles({
                    done: true,
                    open: true,
                    killed: false,
                    incomplete: false,
                    postponed: false,
                    ...(nextState.cohortStatusToggles || {})
                });
                setCohortSelectedRow(nextState.cohortSelectedRow || null);
                applyScenarioGroupState({ setScenarioData, setScenarioError, setScenarioLaneMode, setScenarioCollapsedLanes, setScenarioEpicFocus, setScenarioRangeOverride, setScenarioScrollTop, setScenarioScrollLeft, setScenarioViewportHeight, setScenarioHoverKey, setScenarioFlashKey, setScenarioLayout, setScenarioEdgeRender, setScenarioTooltip, setScenarioLoading }, nextState);
                setHideExcludedStats(nextState.hideExcludedStats ?? true);
                setShowMissingAlert(nextState.showMissingAlert ?? true);
                setShowBlockedAlert(nextState.showBlockedAlert ?? true);
                setShowPostponedAlert(nextState.showPostponedAlert ?? true);
                setShowBacklogAlert(nextState.showBacklogAlert ?? true);
                setShowMissingTeamAlert(nextState.showMissingTeamAlert ?? true);
                setShowMissingLabelsAlert(nextState.showMissingLabelsAlert ?? true);
                setShowNeedsStoriesAlert(nextState.showNeedsStoriesAlert ?? nextState.showCreateStoriesAlert ?? nextState.showWaitingAlert ?? true);
                setShowWaitingAlert(nextState.showWaitingAlert ?? true);
                setShowEmptyEpicAlert(nextState.showEmptyEpicAlert ?? true);
                setShowDoneEpicAlert(nextState.showDoneEpicAlert ?? true);
                setShowAlertsPanel(nextState.showAlertsPanel ?? true);
                setDismissedAlertKeys(nextState.dismissedAlertKeys || []);
                setAlertCelebrationPieces([]);
                setDependencyData(nextState.dependencyData || {});
                setDependencyFocus(nextState.dependencyFocus || null);
                setDependencyLookupCache(nextState.dependencyLookupCache || {});
                setDependencyLookupLoading(false);
                setLoading(false);
                window.setTimeout(() => {
                    restoringGroupRef.current = false;
                }, 0);
            };

            const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), [
                selectedSprint, missingInfoEpics, backlogProductEpics, backlogTechEpics,
                planningScopeKey,
                activeGroupTeamIds.join('|'),
                productTasks,
                techTasks,
                loadedProductTasks,
                loadedTechTasks,
                tasksFetched,
                readyToCloseProductTasks,
                readyToCloseTechTasks,
                missingPlanningInfoTasks,
                productEpicsInScope,
                techEpicsInScope,
                readyToCloseProductEpicsInScope,
                readyToCloseTechEpicsInScope,
                techLoaded,
                error,
                engStatusFilter,
                engPriorityFilter, engProjectTrackFilter,
                showTech,
                showProduct,
                groupByInitiativeChoice,
                selectedTeams,
                selectedTasks,
                planningSelectionMode,
                showPlanning,
                showStats,
                showScenario,
                showBoard,
                boardView,
                engBoardFilterSelection,
                showDependencies,
                epicDetails,
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
                scenarioGroupValues,
                hideExcludedStats,
                showMissingAlert,
                showBlockedAlert,
                showPostponedAlert,
                showBacklogAlert,
                showMissingTeamAlert,
                showMissingLabelsAlert,
                showNeedsStoriesAlert,
                showWaitingAlert,
                showEmptyEpicAlert,
                showDoneEpicAlert,
                dismissedAlertKeys,
                dependencyData,
                dependencyFocus,
                dependencyLookupCache,
                dependencyLookupLoading
            ]);

            useEffect(() => {
                if (!activeGroupId) return;
                if (activeGroupRef.current !== activeGroupId) return;
                if (planningScopeKey && planningHydratedScopeRef.current !== planningScopeKey) return;
                groupStateRef.current.set(activeGroupId, issueEditStateRef.current.reconcileSnapshot(groupStateSnapshot));
            }, [activeGroupId, groupStateSnapshot, planningScopeKey]);

            useEffect(() => {
                if (!activeGroupId) return;
                if (activeGroupRef.current === activeGroupId) return;
                activeGroupRef.current = activeGroupId;
                const cached = groupStateRef.current.get(activeGroupId);
                const matchesScope = cached &&
                    cached.planningScopeKey === planningScopeKey &&
                    cached.sprintId === selectedSprint &&
                    cached.teamIdsSignature === activeGroupTeamIds.join('|');
                if (matchesScope) {
                    applyGroupState(issueEditStateRef.current.reconcileSnapshot(cached));
                } else {
                    const fallback = buildDefaultGroupState(activeGroupId);
                    groupStateRef.current.set(activeGroupId, fallback);
                    applyGroupState(fallback);
                }
                setShowGroupDropdown(false);
            }, [activeGroupId]);

            useEffect(() => {
                if (!planningScopeKey || !activeGroupId || selectedSprint === null) return;
                if (planningHydratedScopeRef.current === planningScopeKey) return;
                const cached = activeGroupId ? groupStateRef.current.get(activeGroupId) : null;
                if (cached &&
                    cached.planningScopeKey === planningScopeKey &&
                    cached.sprintId === selectedSprint &&
                    cached.teamIdsSignature === activeGroupTeamIds.join('|')) {
                    planningHydratedScopeRef.current = planningScopeKey;
                    return;
                }
                const fallback = buildDefaultGroupState(activeGroupId);
                groupStateRef.current.set(activeGroupId, fallback);
                applyGroupState(fallback);
                planningHydratedScopeRef.current = planningScopeKey;
            }, [planningScopeKey, activeGroupId, selectedSprint, activeGroupTeamIds.join('|')]);

            useEffect(() => {
                const resume = pendingShellAuthResumeRef.current;
                const settled = authResumeShellSettledRef.current;
                if (!resume || !settled?.has('group') || !settled.has('sprint')) return;
                const requestedGroupAvailable = resume.activeGroupId
                    && visibleControlGroups.some(group => String(group.id) === resume.activeGroupId);
                if (requestedGroupAvailable && String(activeGroupId) !== resume.activeGroupId) return;
                const requestedSprint = availableSprints.find(sprint => String(sprint.id) === resume.selectedSprint);
                if (requestedSprint && String(selectedSprint) !== resume.selectedSprint) return;
                if (planningScopeKey && planningHydratedScopeRef.current !== planningScopeKey) return;
                if (!sharedConfigReady || !homeTokenConnectionLoaded) return;

                const nextView = resume.selectedView === 'epm' && showEpmNavigation ? 'epm' : 'eng';
                const unavailableMode = (resume.engMode === 'planning' && isCompletedSprintSelected)
                    || (resume.engMode === 'statistics' && isFutureSprintSelected)
                    || (resume.engMode === 'scenario' && isCompletedSprintSelected);
                const nextMode = unavailableMode ? 'catch-up' : resume.engMode;
                if (resume.engMode === 'planning' && nextMode !== 'planning') {
                    pendingPlanningAuthResumeRef.current = null;
                    planningAuthResumeLoadRef.current = null;
                }
                setSelectedView(nextView);
                setShowPlanning(nextMode === 'planning');
                setShowStats(nextMode === 'statistics');
                setShowScenario(nextMode === 'scenario');
                setShowBoard(nextMode === 'board');

                const settingsTabPermitted = resume.settingsTab === 'connections'
                    || DEPARTMENT_SETTINGS_TAB_IDS.has(resume.settingsTab)
                    || (resume.settingsTab === 'epm' && canEditEpmConfiguration && showEpmNavigation)
                    || (ADMIN_SETTINGS_TAB_IDS.has(resume.settingsTab) && canEditSharedConfiguration);
                if (resume.settingsOpen && settingsTabPermitted) {
                    setGroupManageTab(resume.settingsTab);
                    setShowGroupManage(true);
                } else {
                    setShowGroupManage(false);
                }
                pendingShellAuthResumeRef.current = null;
                authResumeShellSettledRef.current = null;
                clearAuthResumeWhenSettled();
            }, [
                activeGroupId, selectedSprint, selectedSprintState, planningScopeKey, visibleControlGroups, availableSprints,
                sharedConfigReady, homeTokenConnectionLoaded, showEpmNavigation,
                canEditEpmConfiguration, canEditSharedConfiguration, clearAuthResumeWhenSettled,
                authResumeStagedRevision,
            ]);

            useEffect(() => {
                if (!showPlanning) {
                    setPlanningOffset(0);
                }
            }, [showPlanning]);

            useEffect(() => {
                if (showPlanning && isCompletedSprintSelected) {
                    setShowPlanning(false);
                }
            }, [showPlanning, isCompletedSprintSelected]);

            useEffect(() => {
                if (showPlanning && !isCompletedSprintSelected && !isFutureSprintSelected) {
                    includePlanningTasksByStatus(['Accepted', 'In Progress']);
                }
            }, [showPlanning, isCompletedSprintSelected, isFutureSprintSelected]);

            useEffect(() => {
                if (!showSprintDropdown) return;
                const dropdownNode = getActiveDropdownNode(sprintDropdownRefs);
                const optionEl = dropdownNode?.querySelector('.sprint-dropdown-option.is-active');
                const listEl = dropdownNode?.querySelector('.sprint-dropdown-list');
                if (!optionEl) return;
                if (!listEl) return;

                const optionTop = optionEl.offsetTop;
                const optionBottom = optionTop + optionEl.offsetHeight;
                const viewportTop = listEl.scrollTop;
                const viewportBottom = viewportTop + listEl.clientHeight;
                const padding = 8;

                if (optionTop < viewportTop) {
                    listEl.scrollTop = Math.max(0, optionTop - padding);
                } else if (optionBottom > viewportBottom) {
                    listEl.scrollTop = Math.max(0, optionBottom - listEl.clientHeight + padding);
                }
            }, [showSprintDropdown, sprintActiveOptionIndex, sprintSearch, filteredSprints?.length, compactStickyVisible]);

            const resetSprintScopedState = React.useCallback(() => {
                abortSprintFetches();
                setDependencyData({});
                setDependencyFocus(null);
                setDependencyLookupCache({});
                setDependencyLookupLoading(false);
                setMissingPlanningInfoTasks([]);
                setBacklogProductEpics([]);
                setBacklogTechEpics([]);
                setScenarioData(null);
                setScenarioError('');
                setScenarioRangeOverride(null);
                setScenarioEpicFocus(null);
                scenarioIssueRefMap.current.clear();
                scenarioPendingScrollRef.current = null;
                scenarioEdgeUpdatePendingRef.current = false;
                scenarioTooltipAnchorRef.current = null;
                if (scenarioEdgeFrameRef.current) {
                    window.cancelAnimationFrame(scenarioEdgeFrameRef.current);
                    scenarioEdgeFrameRef.current = null;
                }
                setScenarioEdgeRender({ width: 0, height: 0, paths: [] });
                setScenarioHoverKey(null);
                setScenarioFlashKey(null);
                setScenarioTooltip(prev => (prev.visible ? { ...prev, visible: false } : prev));
            }, [abortSprintFetches]);

            useEffect(() => {
                if (!selectedSprint) return;
                resetSprintScopedState();
            }, [selectedSprint, resetSprintScopedState]);

            useEffect(() => {
                if (!selectedSprint) return;
                setTasksFetched(false);
                setProductTasks([]);
                setTechTasks([]);
                setLoadedProductTasks([]);
                setLoadedTechTasks([]);
                setTechLoaded(false);
                sprintLoadRef.current = { sprintId: selectedSprint, product: false, tech: false };
                lastLoadedSprintRef.current = null;
            }, [selectedSprint]);

            useEffect(() => {
                if (isCompletedSprintSelected && showScenario) {
                    setShowScenario(false);
                }
            }, [isCompletedSprintSelected, showScenario]);

            useEffect(() => {
                if (showScenario && !restoringGroupRef.current) {
                    setScenarioData(null);
                    setScenarioError('');
                }
            }, [showScenario]);

            useEffect(() => {
                if (showScenario) return;
                scenarioIssueRefMap.current.clear();
                scenarioEdgeUpdatePendingRef.current = false;
                if (scenarioEdgeFrameRef.current) {
                    window.cancelAnimationFrame(scenarioEdgeFrameRef.current);
                    scenarioEdgeFrameRef.current = null;
                }
                if (scenarioScrollFrameRef.current) {
                    window.cancelAnimationFrame(scenarioScrollFrameRef.current);
                    scenarioScrollFrameRef.current = null;
                }
                if (scenarioResizeFrameRef.current) {
                    window.cancelAnimationFrame(scenarioResizeFrameRef.current);
                    scenarioResizeFrameRef.current = null;
                }
                scenarioPendingScrollRef.current = null;
                setScenarioEdgeRender({ width: 0, height: 0, paths: [] });
                setScenarioHoverKey(null);
                setScenarioFlashKey(null);
                setScenarioTooltip(prev => (prev.visible ? { ...prev, visible: false } : prev));
                setScenarioLayout({ width: 0, height: 0 });
            }, [showScenario]);

            useEffect(() => {
                const handleClickOutside = (event) => {
                    const node = getActiveDropdownNode(teamDropdownRefs);
                    if (!node) return;
                    if (!node.contains(event.target)) {
                        setShowTeamDropdown(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, [compactStickyVisible]);

            useEffect(() => {
                const handleClickOutside = (event) => {
                    const node = getActiveDropdownNode(sprintDropdownRefs);
                    if (!node) return;
                    if (!node.contains(event.target)) {
                        setShowSprintDropdown(false);
                        setSprintActiveOptionIndex(0);
                        sprintSelectorOriginRef.current = null;
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, [compactStickyVisible]);

            useEffect(() => {
                const handleClickOutside = (event) => {
                    const node = getActiveDropdownNode(groupDropdownRefs);
                    if (!node) return;
                    if (!node.contains(event.target)) {
                        setShowGroupDropdown(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, [compactStickyVisible]);

            useEffect(() => {
                const handleClickOutside = (event) => {
                    const node = getActiveDropdownNode(epmProjectDropdownRefs);
                    if (!node) return;
                    if (!node.contains(event.target)) {
                        setShowEpmProjectDropdown(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, [compactStickyVisible]);

            useEffect(() => {
                const handleClickOutside = (event) => {
                    const node = getActiveDropdownNode(epmSubGoalFilterDropdownRefs);
                    if (!node) return;
                    if (!node.contains(event.target)) {
                        setShowEpmSubGoalFilterDropdown(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, [compactStickyVisible]);

            useEffect(() => {
                const handleClickOutside = (event) => {
                    const node = getActiveDropdownNode(epmSortDropdownRefs);
                    if (!node) return;
                    if (!node.contains(event.target)) {
                        setShowEpmSortDropdown(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, [compactStickyVisible]);

            useEffect(() => {
                const handle = window.setTimeout(() => {
                    setSearchQuery(searchInput);
                }, 200);
                return () => window.clearTimeout(handle);
            }, [searchInput]);

            useEffect(() => {
                const handleKey = (event) => {
                    if (readPendingAuthenticationRequired()) return;
                    if (event.key !== '/') return;
                    const target = event.target;
                    if (target) {
                        const tag = target.tagName?.toLowerCase();
                        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
                            return;
                        }
                    }
                    event.preventDefault();
                    searchInputRef.current?.focus();
                };
                window.addEventListener('keydown', handleKey);
                return () => window.removeEventListener('keydown', handleKey);
            }, []);

            useEffect(() => {
                if (searchInput !== searchQuery) {
                    setSearchInput(searchQuery || '');
                }
            }, [searchQuery]);

            useEffect(() => {
                const handleScroll = () => {
                    setShowBackToTop(window.scrollY > 120);
                };
                handleScroll();
                window.addEventListener('scroll', handleScroll, { passive: true });
                return () => window.removeEventListener('scroll', handleScroll);
            }, []);

            useEffect(() => {
                saveUiPrefs({
                    selectedView,
                    epmTab,
                    epmSelectedProjectId,
                    epmProjectSort,
                    engEpicSort, planningLayout, planningTeamsEffortExpanded: teamsEffortExpanded,
                    selectedSprint, sprintName, sprintCatalog: sprintCatalogCacheRef.current,
                    selectedTeams,
                    activeGroupId,
                    showPlanning,
                    showStats,
                    showScenario,
                    showBoard,
                    showDependencies,
                    showTech,
                    showProduct,
                    engStatusFilter,
                    engPriorityFilter,
                    groupByInitiativeChoice,
                    searchQuery,
                    statsView,
                    statsGraphMode,
                    burnoutAssigneeFilter,
                    burndownMetric,
                    cohortStartQuarter,
                    cohortEndQuarter,
                    cohortGroupBy,
                    cohortProjectFilter,
                    cohortAssigneeFilter,
                    cohortExcludeAdHoc,
                    cohortExcludeCapacity,
                    cohortStatusToggles,
                    excludedCapacityStartSprintId,
                    excludedCapacityEndSprintId,
                    excludedCapacitySelectedEpicKeys,
                    excludedCapacityChartMode,
                    excludedCapacityMetric,
                    projectTrackCapacitySide,
                    projectTrackMode,
                    projectTrackExcludeAdHoc,
                    projectTrackExcludeExcludedCapacity,
                    scenarioLaneMode,
                    hideExcludedStats,
                    showMissingAlert,
                    showBlockedAlert,
                    showPostponedAlert,
                    showBacklogAlert,
                    showMissingTeamAlert,
                    showMissingLabelsAlert,
                    showNeedsStoriesAlert,
                    showWaitingAlert,
                    showEmptyEpicAlert,
                    showDoneEpicAlert,
                    showAlertsPanel,
                    groupVisibilityPreferences: { visibleGroupIds: groupPreferences.visibleGroupIds || [], activeGroupId: groupPreferences.activeGroupId || activeGroupId },
                    updateDismissedHash
                });
            }, [
                selectedView,
                epmTab,
                epmSelectedProjectId,
                epmProjectSort,
                engEpicSort, planningLayout, teamsEffortExpanded,
                selectedSprint, sprintName,
                selectedTeams,
                activeGroupId,
                showPlanning,
                showStats,
                showScenario,
                showBoard,
                showDependencies,
                showTech,
                showProduct,
                engStatusFilter,
                engPriorityFilter,
                groupByInitiativeChoice,
                searchQuery,
                statsView,
                statsGraphMode,
                burnoutAssigneeFilter,
                burndownMetric,
                cohortStartQuarter,
                cohortEndQuarter,
                cohortGroupBy,
                cohortProjectFilter,
                cohortAssigneeFilter,
                cohortExcludeAdHoc,
                cohortExcludeCapacity,
                cohortStatusToggles,
                excludedCapacityStartSprintId,
                excludedCapacityEndSprintId,
                excludedCapacitySelectedEpicKeys,
                excludedCapacityChartMode,
                excludedCapacityMetric,
                scenarioLaneMode,
                hideExcludedStats,
                showMissingAlert,
                showBlockedAlert,
                showPostponedAlert,
                showBacklogAlert,
                showMissingTeamAlert,
                showMissingLabelsAlert,
                showNeedsStoriesAlert,
                showWaitingAlert,
                showEmptyEpicAlert,
                showDoneEpicAlert,
                showAlertsPanel,
                groupPreferences.visibleGroupIds, groupPreferences.activeGroupId,
                updateDismissedHash
            ]);

            const loadConfig = async ({ preserveEpmDraft = false, replaceWorkspaceDrafts = false } = {}) => {
                const saveReadFence = boardConfigSaveReadFenceRef.current;
                const readGeneration = saveReadFence
                    ? boardConfigReadGenerationRef.current
                    : boardConfigReadGenerationRef.current + 1;
                if (!saveReadFence) boardConfigReadGenerationRef.current = readGeneration;
                const shouldApplyResult = () => saveReadFence === 0
                    && boardConfigSaveReadFenceRef.current === 0
                    && boardConfigReadGenerationRef.current === readGeneration;
                const epmRequestGeneration = epmConfigDraftGenerationRef.current;
                const shouldPreserveEpmDraft = () => preserveEpmDraft
                    || epmConfigDraftGenerationRef.current !== epmRequestGeneration;
                const draftReadGuard = createSettingsDraftReadGuard(() => settingsDraftSnapshotRef.current);
                const initiallyDirtyDrafts = {
                    projects: isProjectsDraftDirty,
                    board: isBoardConfigDirty,
                    capacity: isCapacityDraftDirty,
                    priorityWeights: isPriorityWeightsDirty,
                    issueTypes: isIssueTypesDraftDirty,
                    sprintField: isSprintFieldDirty,
                    parentNameField: isParentNameFieldDirty,
                    storyPointsField: isStoryPointsFieldDirty,
                    teamField: isTeamFieldDirty,
                    deliveryOwnerField: isDeliveryOwnerFieldDirty,
                };
                const shouldPreserveSettingsDraft = section => !replaceWorkspaceDrafts && (
                    initiallyDirtyDrafts[section] || draftReadGuard.draftChanged(section)
                );
                const shouldPreserveFallbackDraft = section => initiallyDirtyDrafts[section]
                    || draftReadGuard.draftChanged(section);
                const sprintCatalogGenerationAtStart = sprintCatalogControllerRef.current.getState().generation;
                setSharedConfigReady(false);
                setBoardBootstrapStatus('loading');
                try {
                    let config = await fetchBootstrapConfig(BACKEND_URL);
                    if (!shouldApplyResult()) return false;
                    const currentSprintCatalogState = sprintCatalogControllerRef.current.getState();
                    if (shouldReconcileSprintCatalogSource(
                        sprintCatalogGenerationAtStart,
                        currentSprintCatalogState,
                        config.sprintCatalogSource || null,
                    )) {
                        try {
                            config = await fetchBootstrapConfig(BACKEND_URL);
                        } catch (error) {
                            sprintCatalogControllerRef.current.invalidate('catalog_identity_changed');
                            throw error;
                        }
                        if (!shouldApplyResult()) return false;
                        if (!sprintCatalogSourcesEqual(
                            sprintCatalogControllerRef.current.getState(),
                            config.sprintCatalogSource || null,
                        )) {
                            sprintCatalogControllerRef.current.invalidate('catalog_identity_changed');
                        }
                    } else {
                        sprintCatalogControllerRef.current.acceptSource(config.sprintCatalogSource || null);
                    }
                    performanceGate.resolve(config.performanceDebugEnabled === true);
                    setPerformanceAdminAvailable(config.performanceAdminAvailable === true);
                    const resumePrincipal = {
                        workspaceId: String(config.viewConfig?.workspaceId || ''),
                        viewConfigId: String(config.viewConfig?.viewConfigId || ''),
                    };
                    if (resumePrincipal.workspaceId && resumePrincipal.viewConfigId) {
                        const recoveryStores = getAuthRecoveryStores(window);
                        if (recoveryStores) {
                            await completeAuthRecovery(
                                recoveryStores.sharedStorage,
                                recoveryStores.tabStorage,
                                {
                                    canComplete: () => !readPendingAuthenticationRequired(),
                                },
                            );
                        }
                    }
                    if (!shouldApplyResult()) return false;
                    authResumePrincipalRef.current = resumePrincipal;
                    connectionRecoveryPrincipalRef.current = connectionRecoveryPrincipalFromConfig(config);
                    const resumeStorage = getAuthResumeStorage(window);
                    const resume = resumeStorage && !planningAuthResumePersistenceFailedRef.current
                        ? readAuthResumeState(resumeStorage, resumePrincipal)
                        : null;
                    const connectionResume = consumeConnectionRecovery(connectionRecoveryPrincipalRef.current);
                    if (resume) {
                        pendingShellAuthResumeRef.current = resume.view;
                        authResumeShellSettledRef.current = new Set();
                        planningAuthResumeLoadRef.current = null;
                        pendingPlanningAuthResumeRef.current = resume.view.selectedView === 'eng'
                            && resume.view.engMode === 'planning'
                            && resume.planning.scopeKey
                            ? resume.planning
                            : null;
                        setAuthResumeStagedRevision(revision => revision + 1);
                    } else if (connectionResume) {
                        pendingShellAuthResumeRef.current = buildConnectionRecoveryShellState(connectionResume);
                        authResumeShellSettledRef.current = new Set();
                        setAuthResumeStagedRevision(revision => revision + 1);
                    }
                    markConnectionBootstrapHealthy('config');
                    clearServerConnectionError();
                    setJiraUrl(config.jiraUrl || '');
                    setAuthMode(config.authMode || '');
                    setCapacityEnabled(Boolean(config.capacityProject || config.capacityConfigRequiresResolution));
                    applyBootstrapPermissions(config);
                    applyAdminSettingsGateConfig(config);
                    const sharedConfig = config.sharedConfig;
                    if (sharedConfig && Number.isInteger(config.sharedConfigRevision)) {
                        applySharedConfigBootstrap(config, shouldPreserveSettingsDraft, shouldPreserveEpmDraft);
                        setBoardAllWorkAvailable(config.boardAllWorkAvailable);
                        acceptedBoardConfigRef.current = true;
                        setBoardBootstrapStatus('ready');
                    } else {
                        if (!shouldPreserveEpmDraft()) applySavedEpmConfig(config.viewConfig?.view?.epm || config.epm);
                        const authorityLoads = [loadSelectedProjects({ readGeneration, preserveDraft: shouldPreserveFallbackDraft('projects') })];
                        const fallbackConfigLoads = [];
                        if (!shouldPreserveSettingsDraft('priorityWeights')) fallbackConfigLoads.push(loadPriorityWeightsConfig({
                            shouldApplyDraft: () => shouldApplyResult() && !shouldPreserveSettingsDraft('priorityWeights'),
                        }));
                        if (config.authMode === 'atlassian_oauth') {
                            authorityLoads.push(loadBoardConfig({ readGeneration, preserveDraft: shouldPreserveFallbackDraft('board') }));
                            if (!shouldPreserveSettingsDraft('capacity')) fallbackConfigLoads.push(loadCapacityConfig({
                                authMode: config.authMode,
                                shouldApplyDraft: () => shouldApplyResult() && !shouldPreserveSettingsDraft('capacity'),
                            }));
                            fallbackConfigLoads.push(loadAllFieldConfigs({
                                shouldApplyResult,
                                readOptionsForField: section => draftReadGuard.fieldReadOptions(section, {
                                    preserveDraft: initiallyDirtyDrafts[section],
                                }),
                            }));
                            if (!shouldPreserveSettingsDraft('issueTypes')) fallbackConfigLoads.push(loadIssueTypesConfig({
                                shouldApplyDraft: () => shouldApplyResult() && !shouldPreserveSettingsDraft('issueTypes'),
                            }));
                        }
                        const [authorityResults] = await Promise.all([
                            Promise.all(authorityLoads),
                            Promise.all(fallbackConfigLoads),
                        ]);
                        if (!shouldApplyResult()) return false;
                        setBoardAllWorkAvailable(config.boardAllWorkAvailable);
                        const authorityReady = authorityResults.every(Boolean);
                        acceptedBoardConfigRef.current = authorityReady;
                        setBoardBootstrapStatus(authorityReady ? 'ready' : 'error');
                    }
                    return true;
                } catch (err) {
                    if (!shouldApplyResult()) return false;
                    acceptedBoardConfigRef.current = false;
                    performanceGate.resolve(false);
                    setBoardBootstrapStatus('error');
                    if (isAuthenticationRequiredError(err)) return false;
                    setAdminSettingsGate(gate => (gate.status === 'pending' ? resolveAdminSettingsGate(null) : gate));
                    if (!reportServerConnectionError(err, { bootstrapPart: 'config' })) {
                        console.error('Failed to load config:', err);
                    }
                    if (!shouldPreserveEpmDraft()) applySavedEpmConfig(createEmptyEpmConfigDraft());
                    return false;
                } finally {
                    if (shouldApplyResult()) setSharedConfigReady(true);
                }
            };

            useEffect(() => {
                if (selectedView !== 'eng' || isStatsSourceOnlyStatsView) return;
                if (boardScopeRequested) return;
                if (!sprintCatalogReady || sprintsLoading || !selectedSprintInfo) return;
                // Load tasks when sprint changes (team is filtered client-side)
                if (selectedSprint === null) {
                    return;
                }

                // Wait for groups config to load before loading tasks
                if (groupsLoading) {
                    return;
                }
                if (groupPreferences.onboardingRequired) {
                    return;
                }

                const groupLoadVersion = ++groupLoadVersionRef.current;
                const shouldApplyGroupLoadResult = () => groupLoadVersionRef.current === groupLoadVersion;
                const pendingPlanningResume = pendingPlanningAuthResumeRef.current;
                const recoveryScopeKey = pendingPlanningResume?.scopeKey === planningScopeKey
                    ? planningScopeKey
                    : '';
                if (recoveryScopeKey) {
                    planningAuthResumeLoadRef.current = {
                        scopeKey: recoveryScopeKey,
                        loadVersion: groupLoadVersion,
                        outcome: 'pending',
                    };
                }

                const forceConfigRefresh =
                    configRefreshNonce !== 0 &&
                    pendingConfigRefreshRef.current === configRefreshNonce;

                // Only skip loading if we have actual cached data
                const shouldSkipLoad = !recoveryScopeKey && !forceConfigRefresh && activeGroupId && (() => {
                    const cached = groupStateRef.current.get(activeGroupId);
                    return cached &&
                        cached.sprintId === selectedSprint &&
                        cached.teamIdsSignature === activeGroupTeamIds.join('|') &&
                        cached.tasksFetched &&
                        lastLoadedSprintRef.current === selectedSprint;
                })();

                if (shouldSkipLoad) {
                    return;
                }

                if (forceConfigRefresh) {
                    pendingConfigRefreshRef.current = 0;
                }

                setEpicDetails({});
                setProductEpicsInScope([]);
                setTechEpicsInScope([]);
                setMissingPlanningInfoTasks([]);
                setMissingInfoEpics([]);
                const measuredLoad = loadMeasuredGroupTasks({ shouldApplyResult: shouldApplyGroupLoadResult });
                const productLoadResult = measuredLoad.product;
                const techLoadResult = measuredLoad.tech;
                if (recoveryScopeKey) {
                    void Promise.all([productLoadResult, techLoadResult]).then((outcomes) => {
                        const pendingLoad = planningAuthResumeLoadRef.current;
                        if (
                            !shouldApplyGroupLoadResult()
                            || pendingLoad?.scopeKey !== recoveryScopeKey
                            || pendingLoad?.loadVersion !== groupLoadVersion
                        ) return;
                        if (
                            outcomes.includes(ENG_TASK_LOAD_OUTCOME.IGNORED)
                            || outcomes.includes(ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED)
                        ) return;
                        pendingLoad.outcome = outcomes.includes(ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE)
                            ? ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE
                            : ENG_TASK_LOAD_OUTCOME.APPLIED;
                        setPlanningAuthResumeLoadRevision(revision => revision + 1);
                    });
                }
                return () => {
                    measuredLoad.cancel();
                    activePerformanceLoadRef.current?.cancel();
                    activePerformanceLoadRef.current = null;
                    groupLoadVersionRef.current += 1;
                    abortSprintFetches();
                };
            }, [selectedView, isStatsSourceOnlyStatsView, boardScopeRequested, sprintCatalogReady, sprintsLoading, selectedSprint, selectedSprintInfo?.id, activeGroupId, activeGroupTeamIds.join('|'), groupsLoading, groupPreferences.onboardingRequired, configRefreshNonce, authResumeStagedRevision]);

            useEffect(() => {
                if (groupsLoading || !groupPreferences.onboardingRequired) return;
                clearEngGroupScopeData();
                setActiveGroupId(null);
                markConnectionBootstrapHealthy('sprints');
                const hasPendingRecovery = pendingShellAuthResumeRef.current || pendingPlanningAuthResumeRef.current;
                const principal = authResumePrincipalRef.current;
                if (
                    !hasPendingRecovery
                    || !sharedConfigReady
                    || !principal?.workspaceId
                    || !principal?.viewConfigId
                    || !homeTokenConnectionLoaded
                ) return;
                if (!readPendingAuthenticationRequired()) {
                    pendingShellAuthResumeRef.current = null;
                    authResumeShellSettledRef.current = null;
                    pendingPlanningAuthResumeRef.current = null;
                    planningAuthResumeLoadRef.current = null;
                    clearAuthResumeWhenSettled();
                }
            }, [
                groupsLoading, groupPreferences.onboardingRequired, sharedConfigReady, homeTokenConnectionLoaded,
                clearEngGroupScopeData, clearAuthResumeWhenSettled, authResumeStagedRevision,
                markConnectionBootstrapHealthy,
            ]);

            useEffect(() => {
                if (!isStatsSourceOnlyStatsView) return;
                abortSprintFetches();
            }, [isStatsSourceOnlyStatsView, abortSprintFetches]);

            const fetchMissingPlanningInfo = async (sprintId, { shouldApplyResult, signal } = {}) => {
                const controller = registerSprintFetch(), requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal, readToken = issueEditStateRef.current.beginRead();
                try {
                    if (!sprintId) return;
                    if (activeGroupId && activeGroupTeamIds.length === 0) {
                        setMissingPlanningInfoTasks([]);
                        return;
                    }
                    const groupComponents = activeGroup?.missingInfoComponents || [];
                    const response = await requestMissingPlanningInfo(BACKEND_URL, {
                        sprintId,
                        teamIds: activeGroupTeamIds,
                        components: groupComponents,
                        signal: requestSignal
                    });
	                    if (!response.ok) return;
	                    const data = await response.json();
	                    if (shouldApplyResult?.() === false) return;
	                    setMissingPlanningInfoTasks(issueEditStateRef.current.reconcileIssues(data.issues || [], readToken));
	                    setMissingInfoEpics(issueEditStateRef.current.reconcileIssues(data.epics || [], readToken));
	                } catch (e) {
                        if (e.name === 'AbortError') return;
	                    // ignore (alerts are best-effort)
                } finally {
                        issueEditStateRef.current.finishRead(readToken); cleanupSprintFetch(controller);
                    }
	            };
            useEffect(() => {
                setTechLoaded(false);
            }, [selectedSprint]);
            useEffect(() => {
                setScenarioData(null);
                setScenarioError('');
            }, [selectedSprint, selectedTeams]);

            const loadSprints = (forceRefresh = false, _options = {}) => (
                forceRefresh
                    ? sprintCatalogControllerRef.current.refresh()
                    : sprintCatalogControllerRef.current.readCurrent()
            );

            useEffect(() => {
                const handlePageHide = () => sprintCatalogControllerRef.current.invalidate('pagehide');
                const handleAuthenticationRequired = () => sprintCatalogControllerRef.current.authLock();
                const handlePageShow = event => {
                    if (!event.persisted) return;
                    sprintCatalogControllerRef.current.invalidate('pageshow');
                    void sprintCatalogControllerRef.current.readCurrent();
                };
                window.addEventListener('pagehide', handlePageHide);
                window.addEventListener('pageshow', handlePageShow);
                window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthenticationRequired);
                return () => {
                    window.removeEventListener('pagehide', handlePageHide);
                    window.removeEventListener('pageshow', handlePageShow);
                    window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthenticationRequired);
                    sprintCatalogControllerRef.current.dispose();
                };
            }, []);

            const priorityOrder = PRIORITY_ORDER;

            const priorityAxis = PRIORITY_AXIS;

            const getTeamInfo = getTaskTeamInfo;
            const {
                fetchTasks,
                fetchBacklogEpics,
                loadGroupTasks,
                loadAlertEpics,
                loadReadyToCloseProductTasks,
                loadReadyToCloseTechTasks,
                loadEpicRefresh, loadEpicAlerts,
            } = useEngSprintData({
                backendUrl: BACKEND_URL,
                performanceGate, issueEditState: issueEditStateRef.current,
                selectedSprint,
                selectedSprintName: selectedSprintInfo?.name || '',
                activeGroupId,
                activeGroupTeamIds,
                activeGroupTeamSet, activeGroupTeamLabels, activeGroupMissingInfoComponents: activeGroup?.missingInfoComponents || [],
                pageLoadRefreshRef,
                sprintLoadRef,
                lastLoadedSprintRef,
                registerSprintFetch,
                cleanupSprintFetch,
                isFutureSprintSelected,
                priorityOrder,
                loadedProductTasks,
                loadedTechTasks,
                setLoading,
                setError,
                setEpicDetails,
                setProductTasks,
                setTechTasks,
                setLoadedProductTasks,
                setLoadedTechTasks,
                setTasksFetched,
                setTechLoaded,
                setProductTasksLoading,
                setTechTasksLoading,
                setProductEpicsInScope,
                setTechEpicsInScope,
                setReadyToCloseProductTasks,
                setReadyToCloseTechTasks,
                setReadyToCloseProductEpicsInScope,
                setReadyToCloseTechEpicsInScope,
                onServerConnectionFailure: reportServerConnectionError,
                onAuthRecoveryRequired: () => trackAppError('auth', 'session_recovery', 'reauth'),
                strictBoardActive: boardScopeRequested,
            });
            const storyReadiness = useStoryReadiness({
                backendUrl: BACKEND_URL,
                enabled: selectedView === 'eng' && (isCatchUpMode || showPlanning),
                primaryReady: tasksFetched
                    && !loading
                    && !productTasksLoading
                    && !techTasksLoading
                    && String(lastLoadedSprintRef.current ?? '') === String(selectedSprint ?? ''),
                groupId: activeGroupId,
                sprintId: selectedSprint,
                sprintName: selectedSprintInfo?.name || '',
                sprintState: selectedSprintState,
                authRevision: authResumeStagedRevision,
                configRevision: `${sharedConfigRevision}:${configRefreshNonce}`,
                refreshRevision: catchUpAlertRefreshNonce,
            });
            const strictBoard = useStrictEngBoardOwner({ active: strictBoardOwnerActive, backendUrl: BACKEND_URL, departmentId: activeGroupId, sprintId: selectedSprint, groupRevision: acceptedStrictBoardRevision, resolvedFocusColumnId: boardView?.focusedId || null, performanceGate, strictScope: boardStrictScope, trackApiResult, onAuthRequired: () => trackAppError('auth', 'session_recovery', 'reauth') });
            const strictBoardData = strictBoard.data; const refreshAfterStrictBoardMutation = strictBoard.refresh; const refreshLegacyBoardTasks = () => loadMeasuredGroupTasks({ forceRefresh: true });
            const loadMeasuredGroupTasks = (options = {}) => {
                loadEpochRef.current += 1;
                activePerformanceLoadRef.current?.cancel();
                const load = loadGroupTasks({ ...options, waitForDependencies: showDependencies || showBlockedAlert,
                    onPrimaryReady: () => setPerformanceLoadRevision(value => value + 1) });
                activePerformanceLoadRef.current = load;
                return load;
            };

            const {
                storySubtasksByKey,
                clearStorySubtasks,
                toggleStorySubtasks,
                retryStorySubtasks,
                applyLocalSubtaskField,
                invalidateStorySubtasks,
            } = useStorySubtasks({
                backendUrl: BACKEND_URL,
                selectedSprint,
                onAuthRecoveryRequired: () => trackAppError('auth', 'session_recovery', 'reauth'),
            });

            const fetchDependencies = async (keys) => {
                if (!keys.length) {
                    setDependencyData({});
                    return;
                }
                if (dependencySkipRef.current.consume(keys.join('|'), loadEpochRef.current)) return ENG_TASK_LOAD_OUTCOME.APPLIED;
                const controller = registerSprintFetch(), readToken = issueEditStateRef.current.beginRead({ aggregate: true });
                try {
                    const response = await requestDependencies(BACKEND_URL, keys, { signal: controller.signal });
                    if (!response.ok) {
                        console.error('Dependencies fetch failed:', response.status);
                        return ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE;
                    }
                    const data = await response.json();
                    if (!issueEditStateRef.current.isCurrentAggregateRead(readToken)) { setDependencyRefreshNonce(value => value + 1); return ENG_TASK_LOAD_OUTCOME.IGNORED; }
                    setDependencyData(data.dependencies || {});
                    return ENG_TASK_LOAD_OUTCOME.APPLIED;
                } catch (err) {
                    if (err.name === 'AbortError') return ENG_TASK_LOAD_OUTCOME.IGNORED;
                    if (isAuthenticationRequiredError(err)) return ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED;
                    console.error('Dependencies fetch error:', err);
                    return ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE;
                } finally {
                    issueEditStateRef.current.finishRead(readToken); cleanupSprintFetch(controller);
                }
            };

            // Per-epic refresh: re-read only this epic's stories and replace just those keys; never bumps the department-wide refetch nonce.
            const refreshEpicDependencies = async (keys) => {
                if ((!showDependencies && !showBlockedAlert) || !keys.length) return;
                const controller = registerSprintFetch(), readToken = issueEditStateRef.current.beginRead({ aggregate: true });
                try {
                    const response = await requestDependencies(BACKEND_URL, keys, { signal: controller.signal, refresh: true });
                    if (!response.ok) return;
                    const data = await response.json();
                    if (!issueEditStateRef.current.isCurrentAggregateRead(readToken)) return;
                    const fetched = data.dependencies || {};
                    setDependencyData(prev => keys.reduce((next, key) => (key in fetched ? { ...next, [key]: fetched[key] } : next), prev));
                } catch (err) {
                    if (err.name !== 'AbortError') console.error('Epic dependencies refresh error:', err);
                } finally {
                    issueEditStateRef.current.finishRead(readToken); cleanupSprintFetch(controller);
                }
            };
            const markDependencySignature = (next, epoch) => {
                if ((showDependencies || showBlockedAlert) && next !== dependencyKeySignature) dependencySkipRef.current.arm(next, epoch);
            };



            // Catch Up alert scope; an oversized-Department result only applies to the scope that produced it.
            const catchUpAlertScopeKey = `${activeGroupId}::${activeGroupTeamIds.join('|')}::${selectedSprint}::${selectedSprintInfo?.name || ''}::${selectedSprintInfo?.state || ''}`;
            const alertScopeTooLarge = Boolean(alertScopeTooLargeKey) && alertScopeTooLargeKey === catchUpAlertScopeKey;
            useEffect(() => {
                setAlertScopeTooLargeKey(key => (key && key !== catchUpAlertScopeKey ? '' : key));
            }, [catchUpAlertScopeKey]);

            useEffect(() => {
                if (selectedView !== 'eng') return;
                if (!isCatchUpMode) return;
                if (!activeGroupId) return;
                if (selectedSprint === null) return;
                if (!selectedSprintInfo) return;
                if (groupsLoading) return;
                if (groupPreferences.onboardingRequired) return;
                if (lastLoadedSprintRef.current !== selectedSprint) return;
                if (!tasksFetched) return;
                if (productTasksLoading || techTasksLoading) return;
                const alertLoadSignature = catchUpAlertScopeKey;
                if (catchUpAlertLoadRef.current === alertLoadSignature) return;
                catchUpAlertLoadRef.current = alertLoadSignature;
                const forceAlertRefresh = catchUpAlertForceRefreshRef.current;
                catchUpAlertForceRefreshRef.current = false;
                const alertController = new AbortController(), alertCohortVersion = ++catchUpAlertVersionRef.current;
                const shouldApplyAlertResult = () => catchUpAlertVersionRef.current === alertCohortVersion;
                const alertCohortToken = {};
                alertCohortRef.current = alertCohortToken;
                const alertEpicsLoad = loadAlertEpics({ forceRefresh: forceAlertRefresh, shouldApplyResult: shouldApplyAlertResult, signal: alertController.signal }).then((alertOutcomes) => {
                    if (!shouldApplyAlertResult()) return;
                    const outcomes = [alertOutcomes?.product, alertOutcomes?.tech];
                    if (outcomes.includes(ENG_TASK_LOAD_OUTCOME.ALERT_SCOPE_TOO_LARGE)) setAlertScopeTooLargeKey(alertLoadSignature);
                    else if (outcomes.every(outcome => outcome === ENG_TASK_LOAD_OUTCOME.APPLIED)) setAlertScopeTooLargeKey('');
                });
                const missingInfoLoad = fetchMissingPlanningInfo(selectedSprint, { shouldApplyResult: shouldApplyAlertResult, signal: alertController.signal });
                const readyToCloseProductLoad = loadReadyToCloseProductTasks({ forceRefresh: forceAlertRefresh, shouldApplyResult: shouldApplyAlertResult, signal: alertController.signal });
                const readyToCloseTechLoad = loadReadyToCloseTechTasks({ forceRefresh: forceAlertRefresh, shouldApplyResult: shouldApplyAlertResult, signal: alertController.signal });
                let cancelled = false, backlogLoad = Promise.resolve();
                if (!isFutureSprintSelected) {
                    setBacklogProductEpics([]);
                    setBacklogTechEpics([]);
                } else if (activeGroupId && activeGroupTeamIds.length === 0) {
                    setBacklogProductEpics([]);
                    setBacklogTechEpics([]);
                } else {
                    const loadBacklog = async () => {
                        const readToken = issueEditStateRef.current.beginRead();
                        try {
                            const [product, tech] = await Promise.all([
                                fetchBacklogEpics('product', { signal: alertController.signal }),
                                fetchBacklogEpics('tech', { signal: alertController.signal })
                            ]);
                            if (cancelled || !shouldApplyAlertResult()) return;
                            setBacklogProductEpics(issueEditStateRef.current.reconcileIssues(product, readToken));
                            setBacklogTechEpics(issueEditStateRef.current.reconcileIssues(tech, readToken));
                        } catch (err) {
                            if (cancelled || !shouldApplyAlertResult()) return;
                            if (isAuthenticationRequiredError(err)) return;
                            setBacklogProductEpics([]);
                            setBacklogTechEpics([]);
                        } finally { issueEditStateRef.current.finishRead(readToken); }
                    };
                    backlogLoad = loadBacklog();
                }
                Promise.allSettled([alertEpicsLoad, missingInfoLoad, readyToCloseProductLoad, readyToCloseTechLoad, backlogLoad])
                    .finally(() => { if (alertCohortRef.current === alertCohortToken) alertCohortRef.current = null; notifyAlertCohortSettle({ aborted: false }); });
                return () => { cancelled = true; alertController.abort(); if (alertCohortRef.current === alertCohortToken) alertCohortRef.current = null; notifyAlertCohortSettle({ aborted: true }); if (catchUpAlertVersionRef.current === alertCohortVersion) { catchUpAlertVersionRef.current += 1; if (catchUpAlertLoadRef.current === alertLoadSignature) catchUpAlertLoadRef.current = ''; } };
            }, [isCatchUpMode, activeGroupId, activeGroupTeamIds.join('|'), selectedSprint, selectedSprintInfo?.name, selectedSprintInfo?.state, groupsLoading, groupPreferences.onboardingRequired, tasksFetched, productTasksLoading, techTasksLoading, isFutureSprintSelected, configRefreshNonce, catchUpAlertRefreshNonce]);

            useEffect(() => {
                if (!showScenario) return;
                if (!selectedSprint) return;
                if (groupsLoading) return;
                if (groupPreferences.onboardingRequired) return;
                if (configRefreshTargetRef.current !== 'scenario') return;
                if (scenarioRefreshNonceRef.current === configRefreshNonce) return;
                if (configRefreshNonce === 0) return;
                if (!tasksFetched || productTasksLoading || techTasksLoading) return;
                scenarioRefreshNonceRef.current = configRefreshNonce;
                runScenario();
            }, [
                showScenario,
                selectedSprint,
                groupsLoading,
                configRefreshNonce,
                tasksFetched,
                productTasksLoading,
                techTasksLoading,
                activeGroupId,
                activeGroupTeamIds.join('|'),
                groupPreferences.onboardingRequired
            ]);

            const effectivePriorityWeightMap = React.useMemo(
                () => buildPriorityWeightMap(effectivePriorityWeightsRows),
                [effectivePriorityWeightsRows]
            );

	            const tasks = React.useMemo(
	                () => showTech ? [...productTasks, ...techTasks] : [...productTasks],
	                [showTech, productTasks, techTasks]
	            );
	            const capacityTasks = React.useMemo(
	                () => [...productTasks, ...techTasks],
	                [productTasks, techTasks]
	            );
	            const readyToCloseTasks = React.useMemo(
	                () => [...readyToCloseProductTasks, ...readyToCloseTechTasks],
	                [readyToCloseProductTasks, readyToCloseTechTasks]
	            );
	            const epicsInScope = React.useMemo(() => {
	                const seen = new Set();
	                const merged = [...productEpicsInScope, ...techEpicsInScope].filter(epic => {
	                    if (!epic?.key) return false;
	                    if (seen.has(epic.key)) return false;
	                    seen.add(epic.key);
	                    return true;
	                });
	                return merged;
	            }, [productEpicsInScope, techEpicsInScope]);
	            // Sprint-scoped epic counts per Jira status name, for the Group Board composer's Min/Max
	            // preview (§5.4/§5.5). Bucketed from the epics already loaded for the active ENG group and
	            // sprint rather than fetched by the composer itself (it must not fetch, per the plan).
	            const epicsByStatus = React.useMemo(() => {
	                const counts = {};
	                epicsInScope.forEach(epic => {
	                    const statusName = String(epic?.status?.name || '').trim();
	                    if (!statusName) return;
	                    counts[statusName] = (counts[statusName] || 0) + 1;
	                });
	                return counts;
	            }, [epicsInScope]);
	            const readyToCloseEpicsInScope = React.useMemo(() => {
	                const seen = new Set();
	                const merged = [...readyToCloseProductEpicsInScope, ...readyToCloseTechEpicsInScope].filter(epic => {
	                    if (!epic?.key) return false;
	                    if (seen.has(epic.key)) return false;
	                    seen.add(epic.key);
	                    return true;
	                });
	                return merged;
	            }, [readyToCloseProductEpicsInScope, readyToCloseTechEpicsInScope]);

            // Retain each team's last known task-derived display name for the session so a
            // configured team keeps its name when a refresh drops its issues; the warmed team
            // catalog lookup still wins when present.
            const lastKnownTeamNamesRef = React.useRef({});
            const teamOptions = React.useMemo(() => {
                const taskNames = {};
                (capacityTasks || []).forEach((task) => {
                    const team = getTeamInfo(task) || {};
                    const id = String(team.id || '').trim();
                    const name = String(team.name || '').trim();
                    if (id && name) taskNames[id] = name;
                });
                lastKnownTeamNamesRef.current = { ...lastKnownTeamNamesRef.current, ...taskNames };
                return buildTeamOptionsForScope({
                    capacityTasks,
                    activeGroupTeamIds,
                    teamNameLookup: { ...lastKnownTeamNamesRef.current, ...teamNameLookup },
                    getTeamInfo
                });
            }, [capacityTasks, activeGroupTeamIds, teamNameLookup]);
            const filteredTeamOptions = React.useMemo(() => {
                const query = teamDropdownQuery.trim().toLowerCase();
                if (!query) return teamOptions;
                return teamOptions.filter(team =>
                    String(team?.name || '').toLowerCase().includes(query)
                );
            }, [teamOptions, teamDropdownQuery]);
            const teamNameById = React.useMemo(() => {
                const map = new Map();
                teamOptions.forEach(team => {
                    if (team.id && team.id !== 'all') {
                        map.set(team.id, team.name);
                    }
                });
                return map;
            }, [teamOptions]);

            const selectedTeamSet = React.useMemo(() => new Set(selectedTeams.filter(id => id !== 'all')), [selectedTeams]);
            const isAllTeamsSelected = selectedTeams.includes('all') || selectedTeamSet.size === 0;
            const isTechTask = React.useCallback(
                (task) => techProjectKeys.has(String(task.fields?.projectKey || task.key.split('-')[0]).toUpperCase()),
                [techProjectKeys]
            );
            // Search and team scope only, over the ungated product+tech merge: `tasks` already
            // drops tech when showTech is off, and counting the facets over that would drop the
            // Tech option to zero, let D20 hide it, and leave it impossible to tick again. The
            // Projects facet does the narrowing below instead.
            const engFilterScopeTasks = React.useMemo(() => {
                // Board matches epics directly, including Delivery Owner — a field
                // matchesEngTaskSearch never checks (§8) — so Board's own search (engBoardSearch.js)
                // runs at the epic level on `epicGroups` below; this scope skips the story-level
                // predicate for it, rather than losing every story under a delivery-owner-only match
                // upstream, before groupTasksByEpic ever sees that epic.
                const query = showBoard ? '' : searchQuery.trim().toLowerCase();
                return capacityTasks.filter(task => {
                    if (!matchesEngTaskSearch(task, query, epicDetails)) {
                        return false;
                    }
                    if (!isAllTeamsSelected) {
                        const teamInfo = getTeamInfo(task);
                        if (!selectedTeamSet.has(teamInfo.id)) {
                            return false;
                        }
                    }
                    return true;
                });
            }, [
                capacityTasks,
                searchQuery,
                epicDetails,
                isAllTeamsSelected,
                selectedTeamSet,
                showBoard
            ]);
            // O6: counts recompute on scope change only, never on a facet tick.
            const engCatchUpFacetModel = React.useMemo(
                () => buildEngCatchUpFacetModel({ tasks: engFilterScopeTasks, isTechTask, epicDetails }),
                [engFilterScopeTasks, isTechTask, epicDetails]
            );
            const engCatchUpFilters = React.useMemo(() => resolveEngCatchUpFilters({
                model: engCatchUpFacetModel,
                status: engStatusFilter,
                priority: engPriorityFilter, track: engProjectTrackFilter,
                showTech,
                showProduct
            }), [engCatchUpFacetModel, engStatusFilter, engPriorityFilter, engProjectTrackFilter, showTech, showProduct]);
            // The stored values go in as well as out: a facet edit only speaks for the options
            // the bar can show, so an exclusion for an option absent from this scope has to be
            // carried forward rather than recomputed away.
            const handleEngFacetChange = React.useCallback((nextSelection) => {
                const next = readEngCatchUpFilterState(nextSelection, engCatchUpFilters.facetViews, {
                    status: engStatusFilter,
                    priority: engPriorityFilter
                });
                setEngStatusFilter(next.status);
                setEngPriorityFilter(next.priority);
                setEngProjectTrackFilter(next.track);
                setShowTech(next.showTech);
                setShowProduct(next.showProduct);
            }, [engCatchUpFilters, engStatusFilter, engPriorityFilter]);
            const scopedTasks = React.useMemo(
                () => engFilterScopeTasks.filter(task => engCatchUpFilters.admitsProject(isTechTask(task)) && engCatchUpFilters.admitsProjectTrack(task)),
                [engFilterScopeTasks, engCatchUpFilters, isTechTask]
            );

            useEffect(() => {
                if (!teamSelectionScopeKey || !activeGroupId || selectedSprint === null) return;
                if (groupsLoading || !tasksFetched) return;

                const validTeamIds = teamOptions
                    .map(team => String(team?.id || '').trim())
                    .filter(id => id && id !== 'all');
                const storedState = loadTeamSelectionState(window.localStorage, teamSelectionScopeKey);
                const baseState = resolveTeamSelectionHydrationState({
                    storedState, liveSelectedTeams: teamSelectionCarryForwardRef.current?.scopeKey === teamSelectionScopeKey ? teamSelectionCarryForwardRef.current.selectedTeams : undefined,
                    savedPrefsSelectedTeams: savedPrefsRef.current.selectedTeams,
                    savedPrefsSelectedTeam: savedPrefsRef.current.selectedTeam
                });
                const reconciled = reconcileTeamSelectionState(baseState, {
                    validTeamIds: new Set(validTeamIds)
                });
                const nextSelectedTeams = sanitizeSelectedTeamsForScope(reconciled.selectedTeams, {
                    activeGroupTeamIds,
                    availableTeamIds: validTeamIds
                });

                const hydrationWillUpdateSelection = !selectedTeamSelectionsEqual(selectedTeams, nextSelectedTeams);
                teamSelectionHydratedScopeRef.current = teamSelectionScopeKey;
                teamSelectionHydratedSelectionRef.current = { scopeKey: teamSelectionScopeKey, selectedTeams: nextSelectedTeams };
                teamSelectionSkipPersistScopeRef.current = hydrationWillUpdateSelection ? teamSelectionScopeKey : '';
                setSelectedTeams(prev => {
                    const normalizedPrev = normalizeSelectedTeams(prev);
                    const sameLength = normalizedPrev.length === nextSelectedTeams.length;
                    const sameTeams = sameLength && normalizedPrev.every((id, index) => id === nextSelectedTeams[index]);
                    return sameTeams ? prev : nextSelectedTeams;
                });
                saveTeamSelectionState(window.localStorage, teamSelectionScopeKey, { selectedTeams: nextSelectedTeams });
                if (teamSelectionCarryForwardRef.current?.scopeKey === teamSelectionScopeKey) teamSelectionCarryForwardRef.current = null;
            }, [
                teamSelectionScopeKey,
                activeGroupId,
                selectedSprint,
                groupsLoading,
                tasksFetched,
                teamOptions,
                activeGroupTeamIds.join('|')
            ]);

            useEffect(() => {
                if (!teamSelectionScopeKey) return;
                if (teamSelectionHydratedScopeRef.current !== teamSelectionScopeKey) return;
                if (teamSelectionSkipPersistScopeRef.current === teamSelectionScopeKey) {
                    teamSelectionSkipPersistScopeRef.current = '';
                    return;
                }
                saveTeamSelectionState(window.localStorage, teamSelectionScopeKey, {
                    selectedTeams
                });
            }, [teamSelectionScopeKey, selectedTeams]);

            const selectedTeamsLabel = React.useMemo(() => {
                if (isAllTeamsSelected) return 'All Teams';
                if (selectedTeamSet.size === 1) {
                    const id = Array.from(selectedTeamSet)[0];
                    return teamNameById.get(id) || '1 Team';
                }
                return `${selectedTeamSet.size} Teams`;
            }, [isAllTeamsSelected, selectedTeamSet, teamNameById]);

            const longestTeamOptionLabel = React.useMemo(() => {
                return teamOptions.reduce((longest, t) => t.name.length > longest.length ? t.name : longest, 'All Teams');
            }, [teamOptions]);



            const toggleTeamSelection = (teamId) => {
                if (teamId === 'all') {
                    if (teamSelectionScopeKey) {
                        saveTeamSelectionState(window.localStorage, teamSelectionScopeKey, { selectedTeams: ['all'] });
                        teamSelectionHydratedSelectionRef.current = { scopeKey: teamSelectionScopeKey, selectedTeams: ['all'] };
                    }
                    setSelectedTeams(['all']);
                    trackFilterChanged('team', { selection_count_bucket: '0' });
                    return;
                }
                setSelectedTeams((prev) => {
                    const next = new Set((prev || []).filter(id => id !== 'all'));
                    if (next.has(teamId)) {
                        next.delete(teamId);
                    } else {
                        next.add(teamId);
                    }
                    trackFilterChanged('team', { selection_count_bucket: bucketCount(next.size) });
                    const nextSelectedTeams = next.size ? Array.from(next) : ['all'];
                    if (teamSelectionScopeKey) {
                        saveTeamSelectionState(window.localStorage, teamSelectionScopeKey, { selectedTeams: nextSelectedTeams });
                        teamSelectionHydratedSelectionRef.current = { scopeKey: teamSelectionScopeKey, selectedTeams: nextSelectedTeams };
                    }
                    return nextSelectedTeams;
                });
            };

            const excludedEpicSet = React.useMemo(() => {
                const set = new Set();
                (activeGroupExcludedCapacityEpics || []).forEach((key) => {
                    const normalized = String(key || '').trim().toUpperCase();
                    if (normalized) set.add(normalized);
                });
                return set;
            }, [activeGroupExcludedCapacityEpics]);
            // Ad Hoc capacity is INCLUDED Product capacity reported separately. It is
            // kept distinct from excludedEpicSet (which subtracts capacity / hides
            // stories) and is passed only to classification/reporting helpers.
            const adHocEpicSet = React.useMemo(() => {
                const set = new Set();
                (activeGroupAdHocCapacityEpics || []).forEach((key) => {
                    const normalized = String(key || '').trim().toUpperCase();
                    if (normalized) set.add(normalized);
                });
                return set;
            }, [activeGroupAdHocCapacityEpics]);
            // Stable signature for memo/cache dependency arrays so Ad Hoc config
            // changes invalidate downstream reporting memos.
            const adHocEpicSignature = React.useMemo(
                () => Array.from(adHocEpicSet).sort().join('|'),
                [adHocEpicSet]
            );
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

            useEffect(() => {
                setBurnoutHoverPoint(null);
                setBurnoutHoverTeamKey(null);
            }, [burnoutData, burnoutAssigneeFilter, statsView]);

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

            const scenario = useScenarioPlanner({
                scenarioState,
                BACKEND_URL,
                EMPTY_ARRAY,
                EMPTY_OBJECT,
                perfEnabled,
                perfCountersRef,
                pendingConnectionRecoveryRef,
                releaseConnectionRecoveryOwnership,
                connectionRecoveryScenarioStartedRef,
                setConnectionRecoveryNotice,
                setConnectionRecoveryStatus,
                connectionRecoveryStagedRevision,
                selectedSprint,
                availableSprints,
                sprintsLoading,
                groupsLoading,
                activeGroupId,
                jiraUrl,
                showScenario,
                searchQuery,
                pendingShellAuthResumeRef,
                selectedSprintInfo,
                trackScenarioAction,
                visibleControlGroups,
                selectedSprintState,
                isCompletedSprintSelected,
                normalizeEpicKey,
                registerSprintFetch,
                cleanupSprintFetch,
                activeGroup,
                teamOptions,
                selectedTeamSet,
                isAllTeamsSelected,
                excludedEpicSet,
            });
            const {
                runScenario,
                scenarioHasUnsavedChanges,
                scenarioJiraEpicKeys,
                scenarioJiraStoryKeys,
            } = scenario;

            useEffect(() => {
                if (isFutureSprintSelected && showStats) {
                    setShowStats(false);
                }
            }, [isFutureSprintSelected, showStats]);

            // Planning selects from this set, so it stays no narrower than the Done and Killed
            // Display toggles were: closed work leaves when the Status facet *excludes* it, and no
            // other status narrowing touches it. Narrowing Catch Up to, say, In Progress must not
            // prune the user's persisted planning selection, which today's statusFilter never did
            // — hence admitsStatusForPlanning, which ignores the `only` form. Under `only` the pool
            // is strictly wider than the old toggles', which can only restore keys, never lose them.
            const baseFilteredTasks = React.useMemo(() => scopedTasks.filter(task => {
                const status = task.fields.status?.name;
                return !isEngClosedWorkStatus(status) || engCatchUpFilters.admitsStatusForPlanning(status);
            }), [scopedTasks, engCatchUpFilters]);

            const selectionTasks = baseFilteredTasks;

            useEffect(() => {
                const pendingPlanningResume = pendingPlanningAuthResumeRef.current;
                if (pendingPlanningResume && pendingShellAuthResumeRef.current) return;
                if (pendingPlanningResume && (!planningScopeKey || pendingPlanningResume.scopeKey !== planningScopeKey)) {
                    pendingPlanningAuthResumeRef.current = null;
                    planningAuthResumeLoadRef.current = null;
                    clearAuthResumeWhenSettled();
                    return;
                }
                if (pendingPlanningResume) {
                    const recoveryLoad = planningAuthResumeLoadRef.current;
                    if (!recoveryLoad || recoveryLoad.scopeKey !== planningScopeKey) return;
                    if (recoveryLoad.outcome === 'pending') return;
                    if (recoveryLoad.outcome === ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE) {
                        pendingPlanningAuthResumeRef.current = null;
                        planningAuthResumeLoadRef.current = null;
                        clearAuthResumeWhenSettled();
                        return;
                    }
                    if (recoveryLoad.outcome !== ENG_TASK_LOAD_OUTCOME.APPLIED) return;
                }
                if (!planningScopeKey || !activeGroupId || selectedSprint === null) return;
                if (!tasksFetched || productTasksLoading || techTasksLoading) return;
                if (lastLoadedSprintRef.current !== selectedSprint) return;
                const hydratedTeamSelection = teamSelectionHydratedSelectionRef.current; if (hydratedTeamSelection?.scopeKey === teamSelectionScopeKey && !selectedTeamSelectionsEqual(selectedTeams, hydratedTeamSelection.selectedTeams)) return;
                if (hydratedTeamSelection?.scopeKey === teamSelectionScopeKey) teamSelectionHydratedSelectionRef.current = null;

                let validTaskKeySet;
                let nextSelectedTaskKeys;
                let nextSelectionMode;
                let nextSelectedTeams;
                if (pendingPlanningResume) {
                    validTaskKeySet = new Set(selectionTasks.map(task => String(task?.key || '').trim()).filter(Boolean));
                    const resumed = resolvePlanningAuthResume({
                        resume: pendingPlanningResume,
                        planningScopeKey,
                        validTaskKeys: validTaskKeySet,
                        validTeamIds: new Set(teamOptions.map(team => String(team?.id || '').trim()).filter(Boolean)),
                    });
                    nextSelectedTaskKeys = resumed.selectedTaskKeys;
                    nextSelectionMode = resumed.selectionMode;
                    nextSelectedTeams = resumed.selectedTeams;
                } else {
                    ({ validTaskKeySet, nextSelectedTaskKeys, nextSelectionMode, nextSelectedTeams } = resolvePlanningSelectionForDashboard({
                        selectedTasks,
                        selectedTeams,
                        planningSelectionMode,
                        isFutureSprintSelected,
                        selectionTasks,
                        teamOptions,
                        activeGroupTeamIds,
                    }));
                }

                setSelectedTasks(prev => {
                    const prevKeys = selectedTaskKeysFromMap(prev, validTaskKeySet);
                    const sameLength = prevKeys.length === nextSelectedTaskKeys.length;
                    const sameKeys = sameLength && prevKeys.every((key, index) => key === nextSelectedTaskKeys[index]);
                    return sameKeys ? prev : selectedTaskMapFromKeys(nextSelectedTaskKeys);
                });

                setSelectedTeams(prev => {
                    const normalizedPrev = normalizeSelectedTeams(prev);
                    const sameLength = normalizedPrev.length === nextSelectedTeams.length;
                    const sameTeams = sameLength && normalizedPrev.every((id, index) => id === nextSelectedTeams[index]);
                    return sameTeams ? prev : nextSelectedTeams;
                });

                setPlanningSelectionMode(prev => prev === nextSelectionMode ? prev : nextSelectionMode);

                const persistenceSucceeded = persistPlanningSelectionState({ storage: window.localStorage, scopeKey: planningScopeKey, selectedTasks: selectedTaskMapFromKeys(nextSelectedTaskKeys), selectionMode: nextSelectionMode, selectedTeams: nextSelectedTeams, normalizeSelectedTeams });
                if (pendingPlanningResume && !persistenceSucceeded) {
                    planningAuthResumePersistenceFailedRef.current = planningScopeKey;
                    planningLoadedSelectionRef.current = null;
                    planningBaselineScopeRef.current = '';
                    setCanUndoPlanningSelection(false);
                    pendingPlanningAuthResumeRef.current = null;
                    planningAuthResumeLoadRef.current = null;
                    clearAuthResumeWhenSettled();
                    return;
                }
                if (planningAuthResumePersistenceFailedRef.current === planningScopeKey) {
                    setCanUndoPlanningSelection(false);
                    return;
                }

                if (pendingPlanningResume || planningBaselineScopeRef.current !== planningScopeKey) {
                    planningLoadedSelectionRef.current = {
                        scopeKey: planningScopeKey,
                        selectedTasks: selectedTaskMapFromKeys(nextSelectedTaskKeys),
                        selectionMode: nextSelectionMode
                    };
                    planningBaselineScopeRef.current = planningScopeKey;
                    setCanUndoPlanningSelection(false);
                }
                if (pendingPlanningResume) {
                    pendingPlanningAuthResumeRef.current = null;
                    planningAuthResumeLoadRef.current = null;
                    clearAuthResumeWhenSettled();
                }
            }, [
                planningScopeKey,
                activeGroupId,
                selectedSprint, teamSelectionScopeKey,
                isFutureSprintSelected,
                tasksFetched,
                productTasksLoading,
                techTasksLoading,
                selectionTasks,
                teamOptions,
                selectedTasks,
                selectedTeams,
                planningSelectionMode,
                activeGroupTeamIds.join('|'),
                authResumeStagedRevision,
                planningAuthResumeLoadRevision,
                clearAuthResumeWhenSettled,
            ]);

            const visibleTasks = React.useMemo(() => baseFilteredTasks.filter(task => (
                engCatchUpFilters.admitsStatus(task.fields.status?.name)
                && engCatchUpFilters.admitsPriority(task.fields.priority?.name)
            )), [baseFilteredTasks, engCatchUpFilters]);
            // trackSearch's result count is reported after epicGroups below: Board's subject is
            // epics, not stories (§7.1), and reporting visibleTasks.length while Board is showing
            // would make every search on that surface report the same unsearched story total —
            // the story-level predicate is bypassed for Board (§8) — leaving zero-result and
            // low-yield detection, the entire point of result_count_bucket, dead on that surface.
            const visibleTasksForList = React.useMemo(() => {
                if (!burnoutTaskFilter || !Array.isArray(burnoutTaskFilter.issueKeys)) {
                    return visibleTasks;
                }
                const scopedKeys = new Set(
                    burnoutTaskFilter.issueKeys
                        .map((key) => String(key || '').trim().toUpperCase())
                        .filter(Boolean)
                );
                return visibleTasks.filter((task) => scopedKeys.has(String(task?.key || '').trim().toUpperCase()));
            }, [visibleTasks, burnoutTaskFilter]);
            const visibleTaskJiraEpicKeys = React.useMemo(
                () => collectJiraExportKeysFromTasks(visibleTasksForList, 'epics'),
                [visibleTasksForList]
            );
            const visibleTaskJiraStoryKeys = React.useMemo(
                () => collectJiraExportKeysFromTasks(visibleTasksForList, 'stories'),
                [visibleTasksForList]
            );
            const visibleTaskKeySet = React.useMemo(() => {
                const keys = new Set();
                visibleTasks.forEach(task => {
                    if (task?.key) {
                        keys.add(task.key);
                    }
                });
                return keys;
            }, [visibleTasks]);
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
            const canRenderStatsPanel = Boolean(effectiveStatsData) || statsView === 'burnout' || statsView === 'cohort' || statsView === 'excludedCapacity' || statsView === 'monoCrossShare' || statsView === 'projectTrack';
            const isLeadTimesFocusMode = showStats && statsView === 'cohort';
            // Catch Up is the all-false fallthrough of the ENG mode booleans, so Board has to opt
            // out here explicitly or the whole task list renders underneath the board.
            const engWorkspaceConfigured = adminSettingsGate.status !== 'missing';
            const shouldRenderEngTaskList = selectedView === 'eng' && !showBoard && !isStatsSourceOnlyStatsView && engWorkspaceConfigured;
            const sprintCatalogWarning = sprintError && sprintCatalogState.validatedSnapshot
                ? sprintError
                : '';
            const displayedEngError = sprintCatalogWarning ? error : (sprintError || error);
            const storyReadinessMessage = storyReadinessStatusMessage(storyReadiness.status, storyRequirementNavigationError);
            const onboardingEngReadiness = deriveOnboardingEngReadiness({
                tasksFetched,
                loading,
                productTasksLoading,
                techTasksLoading,
                displayedEngError
            });
            const retryEngLoad = sprintError ? () => loadSprints(true) : fetchTasks;
            const {
                hierarchy: engWorkHierarchy,
                epicGroups,
                initiativeGroups,
                hasInitiativeData,
                groupByInitiative,
                groupTasksByEpic,
            } = useEngWorkHierarchy({
                visibleTasksForList, epicDetails, capacityTasks,
                readinessSnapshot: storyReadiness.snapshot,
                readinessStatus: storyReadiness.status,
                showPlanning, selectedSprint,
                selectedSprintName: selectedSprintInfo?.name || '',
                selectedSprintState, activeGroupId, selectedTeams, isAllTeamsSelected,
                showTech, showProduct, searchQuery,
                statusNeutral: showPlanning && planningLayout === 'table' ? true : engCatchUpFilters.facetViews?.[0]?.isNeutral && !burnoutTaskFilter,
                priorityNeutral: showPlanning && planningLayout === 'table' ? true : engCatchUpFilters.facetViews?.[1]?.isNeutral && !burnoutTaskFilter,
                admitsEpicProjectTrack: engCatchUpFilters.admitsEpicProjectTrack,
                engEpicSort, groupByInitiativeChoice,
            });
            const planningReviewRows = React.useMemo(() => [
                ...buildPlanningReviewRows({ epicGroups, visibleTasks: visibleTasksForList, mode: 'epic', getTeamInfo }),
                ...buildPlanningReviewRows({ epicGroups, visibleTasks: visibleTasksForList, mode: 'story', getTeamInfo }),
            ], [epicGroups, visibleTasksForList, getTeamInfo]);
            const trackPlanningReviewAction = React.useCallback((action, params = {}) => {
                if (action === 'sort_changed') {
                    trackSortChanged('planning_review', params.sortKey === 'custom' ? 'custom' : ['key', 'summary', 'status', 'priority', 'storyPoints', 'team', 'project', 'assignee', 'epic', 'components', 'capacity', 'projectTrack'].includes(params.sortKey) ? analyticsToken(params.sortKey) : 'custom', { feature_name: 'planning_review', source_surface: 'planning' });
                    return;
                }
                const payload = buildPlanningReviewAnalyticsParams(action, params);
                if (payload) trackProductEvent('planning_action', payload);
            }, [trackProductEvent, trackSortChanged]);
            if (sprintCatalogState.browserContextId) planningReviewBrowserContextRef.current = sprintCatalogState.browserContextId;
            const planningReview = usePlanningSprintReview({
                sprintId: selectedSprint, active: selectedView === 'eng' && showPlanning && planningLayout === 'table' && engWorkspaceConfigured,
                contextKey: `${authMode}|${jiraUrl}|${planningReviewBrowserContextRef.current}|${authResumeStagedRevision}`,
                backendUrl: BACKEND_URL, rows: planningReviewRows, onReviewAction: trackPlanningReviewAction,
            });
            planningReviewGuardRef.current = planningReview.guardScopeChange;
            const planningReviewAdmittedCounts = React.useMemo(() => planningReviewScopeCounts({
                tasks: capacityTasks, selectedTeamIds: selectedTeamSet, allTeams: isAllTeamsSelected,
                groupTeamIds: activeGroupTeamIds, projects: savedSelectedProjects,
                readinessEpics: storyReadiness.snapshot?.epics || [], getTeamInfo,
            }), [capacityTasks, selectedTeamSet, isAllTeamsSelected, activeGroupTeamIds, savedSelectedProjects, storyReadiness.snapshot, getTeamInfo]);
            // Board's own epic-level filter pipeline (§7.1, D19, O6) — sprint/group/team scope
            // only, gated by neither surface's facets (the leak Task 11 flagged).
            const strictBoardPresentation = useStrictEngBoardPresentation({ active: boardScopeRequested, owner: strictBoard, savedBoard: activeGroup?.board || null, searchQuery, showBoard, visibleTaskCount: visibleTasks.length, trackSearch, legacyFilterInput: { scopeTasks: engFilterScopeTasks, epicsInScope, epicDetails, isTechTask, searchQuery, groupTasksByEpic, selection: engBoardFilterSelection } });
            const { boardEpicGroups, boardFilters, boardEpicGroupsFiltered, model: strictBoardModel, workItemKeys: activeJiraExportWorkItemKeys } = strictBoardPresentation;
            const boardJiraEpicKeys = React.useMemo(
                () => normalizeJiraExportKeys(boardEpicGroupsFiltered.filter(group => group.key !== 'NO_EPIC').map(group => group.key)),
                [boardEpicGroupsFiltered]
            );
            const boardJiraStoryKeys = React.useMemo(
                () => collectJiraExportKeysFromTasks(boardEpicGroupsFiltered.flatMap(group => group.tasks || []), 'stories'),
                [boardEpicGroupsFiltered]
            );
            const compactPlanningPanel = showPlanning && planningLayout === 'table' && !planningPanelExpanded;
            const compactStickyTop = compactStickyVisible ? compactHeaderOffset : 0;
            const planningStickyHeight = showPlanning ? planningOffset : 0;
            const filterBarStickyTop = compactStickyTop; const epicStickyTop = compactStickyTop + planningStickyHeight + filterBarHeight;
            useEffect(() => {
                const computeStickyEpicFocus = () => {
                    stickyEpicFrameRef.current = null;
                    const stickyTop = Math.max(0, Number(epicStickyTop) || 0);
                    let nextStickyKey = null;
                    let closestTop = -Infinity;
                    epicRefMap.current.forEach((node, epicKey) => {
                        if (!node || !node.isConnected) return;
                        const header = node.querySelector('.epic-header');
                        if (!header) return;
                        const blockRect = node.getBoundingClientRect();
                        const headerRect = header.getBoundingClientRect();
                        const headerHeight = headerRect.height || 0;
                        const isHeaderPinned = blockRect.top <= stickyTop
                            && blockRect.bottom > (stickyTop + headerHeight + 8);
                        if (!isHeaderPinned) return;
                        if (blockRect.top > closestTop) {
                            closestTop = blockRect.top;
                            nextStickyKey = epicKey;
                        }
                    });
                    setStickyEpicFocusKey(prev => (prev === nextStickyKey ? prev : nextStickyKey));
                };

                const scheduleStickyEpicFocus = () => {
                    if (stickyEpicFrameRef.current != null) return;
                    stickyEpicFrameRef.current = window.requestAnimationFrame(computeStickyEpicFocus);
                };

                scheduleStickyEpicFocus();
                window.addEventListener('scroll', scheduleStickyEpicFocus, { passive: true });
                window.addEventListener('resize', scheduleStickyEpicFocus);
                return () => {
                    window.removeEventListener('scroll', scheduleStickyEpicFocus);
                    window.removeEventListener('resize', scheduleStickyEpicFocus);
                    if (stickyEpicFrameRef.current != null) {
                        window.cancelAnimationFrame(stickyEpicFrameRef.current);
                        stickyEpicFrameRef.current = null;
                    }
                };
            }, [epicGroups, epicStickyTop]);

            const epmRollupExportBoards = React.useMemo(() => {
                const boards = Array.isArray(visibleEpmRollupBoards)
                    ? visibleEpmRollupBoards
                    : (epmRollupTree ? [{ project: selectedEpmProject, tree: epmRollupTree }] : []);
                return boards;
            }, [visibleEpmRollupBoards, epmRollupTree, selectedEpmProject]);
            const epmJiraEpicKeys = React.useMemo(
                () => collectJiraExportKeysFromEpmRollupBoards(epmRollupExportBoards, 'epics'),
                [epmRollupExportBoards]
            );
            const epmJiraStoryKeys = React.useMemo(
                () => collectJiraExportKeysFromEpmRollupBoards(epmRollupExportBoards, 'stories'),
                [epmRollupExportBoards]
            );
            const activeJiraExportEpicKeys = React.useMemo(() => {
                if (selectedView === 'epm') return epmJiraEpicKeys;
                if (showScenario) return scenarioJiraEpicKeys;
                // Board shows one card per epic, so it exports its own epic set rather than the
                // epics implied by the Catch Up story list.
                if (showBoard) return boardJiraEpicKeys;
                return visibleTaskJiraEpicKeys;
            }, [selectedView, showScenario, showBoard, epmJiraEpicKeys, scenarioJiraEpicKeys, boardJiraEpicKeys, visibleTaskJiraEpicKeys]);
            const activeJiraExportStoryKeys = React.useMemo(() => {
                if (selectedView === 'epm') return epmJiraStoryKeys;
                if (showScenario) return scenarioJiraStoryKeys;
                if (showBoard) return boardJiraStoryKeys;
                return visibleTaskJiraStoryKeys;
            }, [selectedView, showScenario, showBoard, epmJiraStoryKeys, scenarioJiraStoryKeys, boardJiraStoryKeys, visibleTaskJiraStoryKeys]);
            const epmDependencyTasks = React.useMemo(() => {
                const boards = epmRollupExportBoards;
                return flattenEpmRollupBoardsForDependencies(boards);
            }, [epmRollupExportBoards]);

            const dependencyTasks = React.useMemo(
                () => selectedView === 'epm' ? epmDependencyTasks : [...loadedProductTasks, ...loadedTechTasks],
                [selectedView, epmDependencyTasks, loadedProductTasks, loadedTechTasks]
            );
            const dependencyKeySignature = React.useMemo(
                () => buildDependencyKeySignature(dependencyTasks),
                [dependencyTasks]
            );

            useEffect(() => {
                if (boardScopeRequested) { setDependencyData({}); return; }
                if (!showDependencies && !showBlockedAlert) {
                    setDependencyData({});
                    if (selectedView === 'eng') activePerformanceLoadRef.current?.dependenciesFinished();
                    return;
                }
                if (selectedView === 'eng') {
                    if (activePerformanceLoadRef.current && !activePerformanceLoadRef.current.primaryReady) return;
                    if (selectedSprint !== null && lastLoadedSprintRef.current !== selectedSprint) return;
                    if (!tasksFetched || productTasksLoading || techTasksLoading) return;
                }
                if (selectedView === 'epm' && epmRollupLoading) {
                    return;
                }
                if (!dependencyKeySignature) {
                    setDependencyData({});
                    if (selectedView === 'eng') activePerformanceLoadRef.current?.dependenciesFinished();
                    return;
                }
                const keys = dependencyKeySignature.split('|').filter(Boolean);
                const measuredLoad = selectedView === 'eng' ? activePerformanceLoadRef.current : null;
                const started = performance.now();
                void fetchDependencies(keys).then(outcome => measuredLoad?.dependenciesFinished(outcome, performance.now() - started));
            }, [selectedView, boardScopeRequested, showDependencies, showBlockedAlert, dependencyKeySignature, selectedSprint, tasksFetched, productTasksLoading, techTasksLoading, epmRollupLoading, performanceLoadRevision, dependencyRefreshNonce]);
            useEffect(() => { dependencySkipRef.current.disarm(); }, [dependencyKeySignature]);

            useEffect(() => {
                if (!showDependencies) {
                    setDependencyFocus(null);
                }
            }, [showDependencies]);

            const issueByKey = React.useMemo(
                () => buildIssueByKey(dependencyTasks),
                [dependencyTasks]
            );

            const activeDependencyFocus = dependencyFocus || dependencyHover;
            const focusRelatedSet = React.useMemo(() => {
                return new Set(activeDependencyFocus?.relatedKeys || []);
            }, [activeDependencyFocus]);

            const selectedEpmProjectUpdateLine = [selectedEpmProject?.latestUpdateDate, selectedEpmProject?.latestUpdateSnippet || 'No updates yet']
                .filter(Boolean)
                .join(' · ');

            const removeTask = (task) => {
                const taskKey = task?.key;
                if (!taskKey) return;
                setProductTasks(prev => prev.filter(t => t.key !== taskKey));
                setTechTasks(prev => prev.filter(t => t.key !== taskKey));
            };

            const prefersReducedMotion = () => (
                window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
            );

            const highlightTaskItem = (element) => {
                if (!element) return;
                if (alertHighlightRef.current && alertHighlightRef.current !== element) {
                    alertHighlightRef.current.classList.remove('task-highlight');
                }
                alertHighlightRef.current = element;
                element.classList.add('task-highlight');
                if (alertHighlightTimeoutRef.current) {
                    window.clearTimeout(alertHighlightTimeoutRef.current);
                }
                alertHighlightTimeoutRef.current = window.setTimeout(() => {
                    element.classList.remove('task-highlight');
                }, 2200);
            };

            const scrollToTaskItem = (taskKey) => {
                if (!taskKey) return false;
                const element = document.querySelector(`[data-issue-key="${taskKey}"]`);
                if (!element) return false;
                element.scrollIntoView({
                    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                    block: 'center'
                });
                highlightTaskItem(element);
                return true;
            };

            const handleAlertStoryClick = (taskKey, editStoryPoints = false) => navigateToAlertStory({
                taskKey, editStoryPoints, revealStory: scrollToTaskItem, clearFilters: clearEngFilters,
                onMissing: key => jiraUrl && window.open(`${jiraUrl}/browse/${key}`, '_blank', 'noopener,noreferrer')
            });

            const dismissAlertItem = (taskKey) => {
                if (!taskKey) return;
                const resolvedTypes = [];
                if (missingAlertKeySet.has(taskKey) && missingAlertKeySet.size === 1) resolvedTypes.push('missing');
                if (blockedAlertKeySet.has(taskKey) && blockedAlertKeySet.size === 1) resolvedTypes.push('blocked');
                if (postponedAlertKeySet.has(taskKey) && postponedAlertKeySet.size === 1) resolvedTypes.push('followup');
                if (needsStoriesAlertKeySet.has(taskKey) && needsStoriesAlertKeySet.size === 1) resolvedTypes.push('waiting');
                if (waitingAlertKeySet.has(taskKey) && waitingAlertKeySet.size === 1) resolvedTypes.push('waiting');
                if (emptyAlertKeySet.has(taskKey) && emptyAlertKeySet.size === 1) resolvedTypes.push('empty');
                if (doneAlertKeySet.has(taskKey) && doneAlertKeySet.size === 1) resolvedTypes.push('done');
                if (resolvedTypes.length) {
                    triggerAlertCelebration({ types: resolvedTypes });
                }
                alertDismissedRef.current = true;
                setDismissedAlertKeys(prev => (prev.includes(taskKey) ? prev : [...prev, taskKey]));
            };

            const handleDependencyFocusClick = (event) => {
                const button = event.target.closest('button[data-dep-chip]');
                if (button) {
                    event.preventDefault();
                    const taskKey = button.getAttribute('data-task-key');
                    const action = button.getAttribute('data-dep-chip');
                    if (!taskKey || !action) return;
                    if (dependencyFocus && dependencyFocus.taskKey === taskKey && dependencyFocus.action === action) {
                        setDependencyFocus(null);
                        return;
                    }
                    const nextFocus = buildDependencyFocusWithScreenState(buildDependencyFocusPayload({
                        taskKey,
                        action,
                        dependencyData,
                        issueByKey
                    }));
                    setDependencyFocus(nextFocus);
                    return;
                }
                if (dependencyFocus && !event.target.closest('.task-item')) {
                    setDependencyFocus(null);
                }
            };

            const handleDependencyHoverEnter = (taskKey, action) => {
                if (!taskKey || !action) return;
                if (dependencyFocus) return;
                setDependencyHover(buildDependencyFocusPayload({
                    taskKey,
                    action,
                    dependencyData,
                    issueByKey
                }));
            };

            const handleDependencyHoverLeave = (taskKey, action) => {
                if (dependencyFocus) return;
                setDependencyHover((prev) => {
                    if (!prev) return prev;
                    if (prev.taskKey !== taskKey || prev.action !== action) return prev;
                    return null;
                });
            };

            useEffect(() => {
                if (dependencyFocus) {
                    setDependencyHover(null);
                }
            }, [dependencyFocus]);

            useEffect(() => {
                if (!dependencyFocus) return;
                const handleKey = (event) => {
                    if (readPendingAuthenticationRequired()) return;
                    if (event.key === 'Escape') {
                        setDependencyFocus(null);
                    }
                };
                window.addEventListener('keydown', handleKey);
                return () => window.removeEventListener('keydown', handleKey);
            }, [dependencyFocus]);

            useEffect(() => {
                if (!dependencyFocus) return;
                const missingKeys = (dependencyFocus.missingKeys || []).filter(key => !dependencyLookupCache[key]);
                if (!missingKeys.length) return;
                let isCancelled = false;
                const controller = registerSprintFetch(), readToken = issueEditStateRef.current.beginRead();
                const fetchLookup = async () => {
                    setDependencyLookupLoading(true);
                    try {
                        const response = await requestIssuesLookup(BACKEND_URL, missingKeys, { signal: controller.signal });
                        if (!response.ok) {
                            console.error('Dependency lookup failed:', response.status);
                            return;
                        }
                        const data = await response.json();
                        if (isCancelled) return;
                        const issues = issueEditStateRef.current.reconcileIssues(data.issues || [], readToken);
                        setDependencyLookupCache(prev => {
                            const next = { ...prev };
                            issues.forEach(issue => {
                                if (issue.key) {
                                    next[issue.key] = issue;
                                }
                            });
                            return next;
                        });
                    } catch (err) {
                        if (err.name === 'AbortError') return;
                        console.error('Dependency lookup error:', err);
                    } finally {
                        issueEditStateRef.current.finishRead(readToken); if (!isCancelled) {
                            setDependencyLookupLoading(false);
                        }
                        cleanupSprintFetch(controller);
                    }
                };
                fetchLookup();
                return () => {
                    isCancelled = true;
                    try {
                        controller.abort();
                    } catch (err) {
                        // ignore
                    }
                };
            }, [dependencyFocus, dependencyLookupCache]);

            const {
                toggleTaskSelection,
                clearSelectedTasks,
                selectAllVisiblePlanningTasks,
                selectPlanningTasksByStatus,
                includePlanningTasksByStatus,
                toggleIncludeByStatus,
                undoPlanningSelectionChange
            } = createPlanningSelectionHandlers({
                storage: window.localStorage,
                planningScopeKey,
                selectedTasks,
                selectedTeams,
                selectionTasks,
                visibleTasksForList,
                isFutureSprintSelected,
                normalizeStatus,
                normalizeSelectedTeams,
                setPlanningSelectionMode,
                setCanUndoPlanningSelection,
                setSelectedTasks,
                trackPlanningSelection,
                planningLoadedSelectionRef
            });

            const selectPlanningReviewStories = (stories, selected) => {
                const next = { ...selectedTasks };
                const visible = new Set(visibleTasksForList.map(task => task.key));
                stories.forEach(task => { if (visible.has(task.key)) { if (selected) next[task.key] = true; else delete next[task.key]; } });
                if (planningLoadedSelectionRef.current?.scopeKey === planningScopeKey) setCanUndoPlanningSelection(true);
                setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
                persistPlanningSelectionState({ storage: window.localStorage, scopeKey: planningScopeKey, selectedTasks: next, selectionMode: PLANNING_SELECTION_MODE_MANUAL, selectedTeams, normalizeSelectedTeams });
                setSelectedTasks(next);
                trackPlanningSelection('select_epic_visible', next, selectionTasks);
            };

            const canToggleSharedGroupExcludedCapacity = canEditSharedConfiguration && !(showGroupManage && isGroupDraftDirty);

            const toggleSharedGroupExcludedCapacityEpic = (epicKey) => saveSharedExcludedCapacityToggle({
                backendUrl: BACKEND_URL,
                epicKey,
                activeGroupId,
                canEditSharedConfiguration,
                showGroupManage,
                isGroupDraftDirty,
                showPlanning,
                groupsConfig,
                applySavedGroupsConfig,
                setGroupDraftError,
                trackSettingsAction,
                groupStateRef,
                excludedCapacityCacheRef
            });

            // Calculate sum of Story Points for selected tasks
            const calculateSelectedSP = () => {
                let sum = 0;
                selectionTasks.forEach(task => {
                    if (selectedTasks[task.key]) {
                        const sp = task.fields.customfield_10004;
                        if (sp) {
                            sum += parseFloat(sp);
                        }
                    }
                });
                return sum;
            };

            const selectedTasksList = React.useMemo(() => {
                if (!showPlanning) return [];
                return selectionTasks.filter(task => selectedTasks[task.key]);
            }, [showPlanning, selectionTasks, selectedTasks]);
            const acceptedStatusSet = React.useMemo(() => new Set(['accepted', 'in progress']), []);
            const acceptedTasks = React.useMemo(() => {
                if (!showPlanning) return [];
                return selectionTasks.filter(task =>
                    acceptedStatusSet.has(normalizeStatus(task.fields.status?.name))
                );
            }, [showPlanning, selectionTasks, acceptedStatusSet]);
            const todoPendingTasks = React.useMemo(() => {
                if (!showPlanning) return [];
                return selectionTasks.filter(task => {
                    const status = normalizeStatus(task.fields.status?.name);
                    return status === 'to do' || status === 'pending';
                });
            }, [showPlanning, selectionTasks]);
            const planningPostponedTasks = React.useMemo(() => {
                if (!showPlanning) return [];
                return selectionTasks.filter(task => {
                    const status = normalizeStatus(task.fields.status?.name);
                    return status === 'postponed';
                });
            }, [showPlanning, selectionTasks]);
            const planningAwaitingValidationTasks = React.useMemo(() => {
                if (!showPlanning) return [];
                return selectionTasks.filter(task => {
                    const status = normalizeStatus(task.fields.status?.name);
                    return status === 'awaiting validation';
                });
            }, [showPlanning, selectionTasks]);
            const isAcceptedIncluded = acceptedTasks.length > 0 &&
                acceptedTasks.every(task => selectedTasks[task.key]);
            const isTodoIncluded = todoPendingTasks.length > 0 &&
                todoPendingTasks.every(task => selectedTasks[task.key]);
            const isPostponedIncluded = planningPostponedTasks.length > 0 &&
                planningPostponedTasks.every(task => selectedTasks[task.key]);
            const isAwaitingValidationIncluded = planningAwaitingValidationTasks.length > 0 &&
                planningAwaitingValidationTasks.every(task => selectedTasks[task.key]);
            const areAllVisiblePlanningTasksSelected = showPlanning &&
                visibleTasksForList.length > 0 &&
                visibleTasksForList.every(task => selectedTasks[task.key]);

            const selectedPlanningTasksList = React.useMemo(() => {
                if (!showPlanning) return [];
                return buildSelectedPlanningTasksList(selectedTasksList, excludedEpicSet, normalizeEpicKey);
            }, [showPlanning, selectedTasksList, excludedEpicSet]);
            const selectedSP = React.useMemo(() => showPlanning ? sumPlanningStoryPoints(selectedTasksList) : 0, [showPlanning, selectedTasksList]);
            const selectedCount = showPlanning ? selectedTasksList.length : 0;
            const statusTransitionSourceSurface = showPlanning ? 'planning' : showBoard ? 'board' : 'catch_up';
            const statusTransitionEnabled = isStatusTransitionSurfaceEnabled({
                selectedView, showPlanning, showStats, showScenario,
            }) && !showGroupManage;
            const [statusTransitionSubmitting, setStatusTransitionSubmitting] = useState(false);
            const [onboardingPreviewSession, setOnboardingPreviewSession] = useState(null);
            const onboardingPreviewDescriptorMatches = React.useCallback((left, right) => Boolean(left && right
                && left.sessionId === right.sessionId
                && left.stepId === right.stepId
                && left.fieldKind === right.fieldKind
                && left.issueKey === right.issueKey
                && left.targetIdentity === right.targetIdentity), []);
            const handleOnboardingPreviewTargetChange = React.useCallback((descriptor) => {
                setOnboardingPreviewSession(descriptor ? { ...descriptor, state: 'closed', reason: '' } : null);
            }, []);
            const handleOnboardingPreviewLifecycleChange = React.useCallback((descriptor, lifecycle) => {
                setOnboardingPreviewSession((current) => (
                    !onboardingPreviewDescriptorMatches(current, descriptor)
                        || (current.state === 'closed' && !['loading', AUTHENTICATION_REQUIRED_CODE].includes(lifecycle?.state))
                        ? current
                        : { ...current, state: lifecycle?.state || current.state, reason: lifecycle?.reason || '' }
                ));
            }, [onboardingPreviewDescriptorMatches]);
            const invalidateEngIssueFieldSources = ({ field }) => {
                if (field === 'assignee') {
                    burnoutCacheRef.current = {}; cohortCacheRef.current = {}; excludedCapacityCacheRef.current = {}; setBurnoutData(null); setCohortData(null); setExcludedCapacityData(null); setIssuePeopleStatsRevision(value => value + 1); setExcludedCapacityRefreshNonce(value => value + 1); rearmCatchUpAlerts();
                } else if (field === 'customfield_10004' || field === 'storyPoints') {
                    excludedCapacityCacheRef.current = {}; setExcludedCapacityData(null); setDependencyData({}); setDependencyLookupCache({}); setDependencyRefreshNonce(value => value + 1); setExcludedCapacityRefreshNonce(value => value + 1); rearmCatchUpAlerts();
                }
            };
            // Status and priority edits: Catch Up re-checks only the edited epic (priority re-checks none); anything the scoped path cannot
            // handle (other modes, unresolved or NO_EPIC keys) takes the request-free department invalidation; no succeeded key changes nothing.
            const invalidateAlertsAfterEdit = ({ keys, field }) => {
                if (!keys?.length) return;
                if (!epicRefresh.recheckAlertsForEdit({ keys, field }).handled) rearmCatchUpAlerts();
            };
            issueEditStateRef.current.setInvalidationHandler(invalidateEngIssueFieldSources);
            const applyLocalEngIssueField = React.useCallback((issueKey, fieldName, fieldValue) => {
                recentEditKeysRef.current.set(issueKey, Date.now());
                strictBoard.applyIssueField(issueKey, fieldName, fieldValue);
                storyReadiness.applyIssueField?.(issueKey, fieldName, fieldValue);
                const patchList = prev => patchEngIssueList(prev, issueKey, fieldName, fieldValue);
                [setProductTasks, setTechTasks, setLoadedProductTasks, setLoadedTechTasks, setReadyToCloseProductTasks, setReadyToCloseTechTasks,
                    setProductEpicsInScope, setTechEpicsInScope, setReadyToCloseProductEpicsInScope, setReadyToCloseTechEpicsInScope,
                    setMissingPlanningInfoTasks, setMissingInfoEpics, setBacklogProductEpics, setBacklogTechEpics].forEach(setter => setter(patchList));
                setEpicDetails(prev => applyLocalEpicDetailsFieldUpdate(prev, issueKey, fieldName, fieldValue));
                groupStateRef.current = patchEngLoadedState({}, groupStateRef.current, issueKey, fieldName, fieldValue).groups;
                invalidateEngIssueFieldSources({ field: fieldName });
                applyLocalSubtaskField(issueKey, fieldName, fieldValue);
            }, [applyLocalSubtaskField, strictBoard, storyReadiness.applyIssueField]);
            const strictBoardMutationProps = strictEngBoardMutationProps({ active: boardScopeRequested, coordinator: strictBoard.mutationCoordinator, refresh: refreshAfterStrictBoardMutation, sourceSurface: statusTransitionSourceSurface, loadLegacy: refreshLegacyBoardTasks, retrySubtasks: retryStorySubtasks });
            const issueFieldEdits = useEngIssueFieldEdits({ backendUrl: BACKEND_URL, issueEditState: issueEditStateRef.current, getContextKey: () => `${authMode}|${jiraUrl}|${authResumeStagedRevision}`,
                onAuthRecoveryRequired: () => trackAppError('auth', 'session_recovery', 'reauth'), onAction: (workflowAction, editor, result) => trackIssueFieldEditAction(workflowAction, { fieldName: editor.field === 'deliveryOwner' ? 'delivery_owner' : editor.field === 'storyPoints' ? 'story_points' : editor.field, issueKind: editor.issueKind, sourceSurface: editor.sourceSurface, result }), onConfirm: ({ issueKey, field, value }) => applyLocalEngIssueField(issueKey, field === 'storyPoints' ? 'customfield_10004' : field, value) });
            const issueFieldEditsEnabled = authMode === 'atlassian_oauth' && statusTransitionEnabled; React.useEffect(() => { issueFieldEdits.contextChanged(); }, [selectedSprint, activeGroupId, statusTransitionSourceSurface, issueFieldEditsEnabled]);
            const statusTransitions = useEngStatusTransitions({
                backendUrl: BACKEND_URL,
                selectedStories: selectedTasksList,
                storySubtasksByKey,
                selectedSprint,
                sourceSurface: statusTransitionSourceSurface,
                ...strictBoardMutationProps.status,
                mutationScopeKey: `${strictBoardData.scope?.type || ''}|${strictBoardData.scope?.sprintId || selectedSprint || ''}|${activeGroupId || ''}|${statusTransitionSourceSurface}`,
                trackIssueStatusAction,
                onAuthRecoveryRequired: () => trackAppError('auth', 'session_recovery', 'reauth'),
                onApplyLocalStatus: (issueKey, statusName) => {
                    applyLocalEngIssueField(issueKey, 'status', { name: statusName });
                },
                onAlertDataInvalidated: ({ keys } = {}) => invalidateAlertsAfterEdit({ keys, field: 'status' }),
            });
            const {
                activeSingleIssueTarget: statusTransitionActiveTarget,
                openSingleIssueStatusControl, prefetchSingleIssueStatusOptions, closeSingleIssueStatusControl,
                transitionOptions, transitionOptionsLoading,
                transitionError, transitionErrorCode, transitionResult,
                pendingIssueKeys: pendingStatusIssueKeys, submitStatusTransition,
            } = statusTransitions;

            const statusTransitionActiveKey = statusTransitionActiveTarget?.key || null;

            const priorityTransitionEnabled = statusTransitionEnabled;
            const priorityTransitions = useEngPriorityTransitions({
                backendUrl: BACKEND_URL,
                selectedSprint,
                sourceSurface: statusTransitionSourceSurface,
                ...strictBoardMutationProps.priority,
                mutationScopeKey: `${strictBoardData.scope?.type || ''}|${strictBoardData.scope?.sprintId || selectedSprint || ''}|${activeGroupId || ''}|${statusTransitionSourceSurface}`,
                trackIssuePriorityAction,
                onAuthRecoveryRequired: () => trackAppError('auth', 'session_recovery', 'reauth'),
                onApplyLocalPriority: (issueKey, priorityPatch) => {
                    applyLocalEngIssueField(issueKey, 'priority', priorityPatch);
                    storyReadiness.patchEpic(issueKey, 'priority', priorityPatch); // readiness-only epics: no-op for any other key
                },
                onAlertDataInvalidated: ({ keys } = {}) => invalidateAlertsAfterEdit({ keys, field: 'priority' }),
            });
            const {
                activePriorityTarget, openPriorityControl, closePriorityControl,
                priorityOptions, priorityOptionsLoading, prioritySubmitting,
                priorityError, priorityResult,
                pendingIssueKeys: pendingPriorityIssueKeys, submitPriorityChange,
            } = priorityTransitions;
            const priorityTransitionActiveKey = activePriorityTarget?.key || null;

            const projectTrackTransitionEnabled = priorityTransitionEnabled;
            const projectTrackTransitions = useEngProjectTrackTransitions({
                backendUrl: BACKEND_URL,
                selectedSprint,
                sourceSurface: statusTransitionSourceSurface,
                ...strictBoardMutationProps.projectTrack,
                mutationScopeKey: `${strictBoardData.scope?.type || ''}|${strictBoardData.scope?.sprintId || selectedSprint || ''}|${activeGroupId || ''}|${statusTransitionSourceSurface}`,
                trackIssueProjectTrackAction,
                onAuthRecoveryRequired: () => trackAppError('auth', 'session_recovery', 'reauth'),
                onApplyLocalProjectTrack: (issueKey, value) => applyLocalEngIssueField(issueKey, 'projectTrack', value),
            });
            const {
                activeProjectTrackTarget, openProjectTrackControl, closeProjectTrackControl,
                projectTrackOptions, projectTrackOptionsLoading, projectTrackSubmitting,
                projectTrackError, projectTrackResult,
                pendingProjectTrackIssueKeys, submitProjectTrackChange,
            } = projectTrackTransitions;
            const projectTrackTransitionActiveKey = activeProjectTrackTarget?.key || null;
            const handleOnboardingPreviewCloseRequest = React.useCallback((descriptor, reason) => {
                if (!onboardingPreviewDescriptorMatches(onboardingPreviewSession, descriptor)) return;
                if (descriptor.fieldKind === 'priority') closePriorityControl();
                else if (descriptor.fieldKind === 'track') closeProjectTrackControl();
                else if (descriptor.fieldKind === 'status') closeSingleIssueStatusControl();
                setOnboardingPreviewSession((current) => (
                    onboardingPreviewDescriptorMatches(current, descriptor)
                        ? { ...current, state: 'closed', reason }
                        : current
                ));
            }, [closePriorityControl, closeProjectTrackControl, closeSingleIssueStatusControl, onboardingPreviewDescriptorMatches, onboardingPreviewSession]);

            // Planning composed target list (the selected Stories) drives the "Apply to selected
            // targets (N)" count and the action bar feedback. Catch Up acts on one explicit
            // issue, so its count stays 0.
            const planningStatusTargets = React.useMemo(() => {
                if (statusTransitionSourceSurface !== 'planning') return [];
                return buildEngStatusTargets({ selectedTasksList });
            }, [statusTransitionSourceSurface, selectedTasksList]);
            const statusTransitionTargetsCount = planningStatusTargets.length;

            // The hook clears status options on sprint change but not on group change; close
            // the open menus here so a group switch never carries a stale one.
            React.useEffect(() => {
                closeSingleIssueStatusControl();
                closePriorityControl();
                closeProjectTrackControl();
            }, [activeGroupId, closeSingleIssueStatusControl, closePriorityControl, closeProjectTrackControl]);

            // The hook exposes no submitting flag; track it around the awaited submit so
            // the menu can disable its action and show an in-flight state.
            // `singleIssue` marks an Epic or Subtask pill: in Planning it changes only that issue,
            // whereas a Story pill applies to the selected Stories.
            const handleSubmitStatusTransition = React.useCallback(async (targetStatus, issue, { singleIssue = false } = {}) => {
                if (statusTransitionSourceSurface === 'catch_up' || (singleIssue && issue?.key)) {
                    return submitStatusTransition(targetStatus, issue?.key);
                }
                // Board acts on ONE explicit issue, like Catch Up. Without a key the hook falls
                // through to Planning's composed target set — the Planning selection — which is a
                // silent no-op at best and a write to issues the user never touched at worst. A
                // dragged card is the first caller whose issue is not a menu argument, so refuse.
                if (statusTransitionSourceSurface === 'board' && !issue?.key) return null;
                if (statusTransitionSubmitting) return null;
                setStatusTransitionSubmitting(true);
                try {
                    return await submitStatusTransition(
                        targetStatus,
                        statusTransitionSourceSurface === 'board' || singleIssue ? issue?.key : undefined,
                    );
                } finally {
                    setStatusTransitionSubmitting(false);
                }
            }, [statusTransitionSubmitting, statusTransitionSourceSurface, submitStatusTransition]);

            const selectedTeamStats = React.useMemo(() => {
                if (!showPlanning) return {};
                return buildSelectedTeamStats(selectedTasksList, getTeamInfo);
            }, [showPlanning, selectedTasksList]);

            const selectedProjectStats = React.useMemo(() => {
                if (!showPlanning) return {};
                return buildSelectedProjectStats(selectedPlanningTasksList, techProjectKeys, adHocEpicSet);
            }, [showPlanning, selectedPlanningTasksList, techProjectKeys, adHocEpicSet, adHocEpicSignature]);

            const selectedTeamProjectStats = React.useMemo(() => {
                if (!showPlanning) return {};
                return buildSelectedTeamProjectStats(selectedPlanningTasksList, getTeamInfo, techProjectKeys, adHocEpicSet);
            }, [showPlanning, selectedPlanningTasksList, techProjectKeys, adHocEpicSet, adHocEpicSignature]);

            // Ad Hoc story points already counted inside the PRODUCT bucket, surfaced
            // separately so the split bar can report the Product Ad Hoc portion.
            const selectedAdHocProductSP = React.useMemo(() => {
                if (!showPlanning || adHocEpicSet.size === 0) return 0;
                return selectedPlanningTasksList.reduce((sum, task) => {
                    if (classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet }).capacityType !== 'ad_hoc') {
                        return sum;
                    }
                    const sp = parseFloat(task.fields?.customfield_10004 || 0);
                    return Number.isNaN(sp) ? sum : sum + sp;
                }, 0);
            }, [showPlanning, selectedPlanningTasksList, techProjectKeys, adHocEpicSet, adHocEpicSignature]);

            const excludedProjectStats = React.useMemo(() => {
                if (!showPlanning) return {};
                return buildExcludedProjectStats(selectedTasksList, excludedEpicSet, techProjectKeys, normalizeEpicKey);
            }, [showPlanning, selectedTasksList, excludedEpicSet, techProjectKeys]);

            const capacitySplit = React.useMemo(() => ({ product: 0.7, tech: 0.3 }), []);
            const capacityMultiplier = showProduct && showTech
                ? 1
                : showProduct
                    ? capacitySplit.product
                    : showTech
                        ? capacitySplit.tech
                        : 1;
            const capacityShareLabel = getCapacityShareLabel({ showProduct, showTech, capacitySplit });

            const teamCapacityStats = React.useMemo(() => {
                return buildTeamCapacityStats({
                    showPlanning,
                    capacityEnabled,
                    capacityTasks,
                    normalizeStatus,
                    getTeamInfo,
                    techProjectKeys,
                    adHocEpicSet
                });
            }, [showPlanning, capacityEnabled, capacityTasks, techProjectKeys, adHocEpicSet, adHocEpicSignature]);

            const teamCapacityEntries = React.useMemo(() => {
                return buildTeamCapacityEntries(teamCapacityStats);
            }, [teamCapacityStats]);

            const displayedTeamCapacityEntries = React.useMemo(() => {
                return !isAllTeamsSelected
                    ? teamCapacityEntries.filter(entry => selectedTeamSet.has(entry.id))
                    : teamCapacityEntries;
            }, [teamCapacityEntries, isAllTeamsSelected, selectedTeamSet]);

            const teamSpTotals = React.useMemo(() => {
                return buildTeamSpTotals(capacityTasks, getTeamInfo);
            }, [capacityTasks]);

            const displayedTeamOptions = React.useMemo(() => {
                return buildDisplayedTeamOptions({
                    teamOptions,
                    isAllTeamsSelected,
                    selectedTeamSet,
                    teamSpTotals
                });
            }, [teamOptions, isAllTeamsSelected, selectedTeamSet, teamSpTotals]);

            const capacityTeamNames = React.useMemo(() => {
                if (!showPlanning || !capacityEnabled) return [];
                const teamsByKey = new Map();
                for (const team of displayedTeamOptions) {
                    const teamName = normalizeCapacityTeamName(team.name);
                    const key = normalizeCapacityKey(teamName);
                    if (key && !teamsByKey.has(key)) teamsByKey.set(key, teamName);
                }
                return Array.from(teamsByKey.entries())
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([, teamName]) => teamName);
            }, [showPlanning, capacityEnabled, displayedTeamOptions]);

            // A per-epic refresh (#213) pins the previous signature until the scope changes or a department load bumps loadEpochRef (read during render on purpose: loads set state, so a render follows); the trade-off is that a team crossing zero Story Points is not reread until then.
            const capacityScopeKey = [selectedSprintInfo?.name, activeGroupId, showPlanning, capacityEnabled, loadEpochRef.current, isAllTeamsSelected, [...selectedTeamSet].sort().join(',')].join('|');
            if (capacityScopeKeyRef.current !== capacityScopeKey) { capacityScopeKeyRef.current = capacityScopeKey; capacityScopePinRef.current = null; activeCapacityScopeRef.current = ''; }
            if (showPlanning && capacityScopeHoldRef.current && activeCapacityScopeRef.current && !capacityScopePinRef.current) capacityScopePinRef.current = { key: capacityScopeKey, signature: activeCapacityScopeRef.current };
            const capacityScopeSignature = capacityScopePinRef.current ? capacityScopePinRef.current.signature : buildCapacityScopeSignature(
                selectedSprintInfo?.name || '',
                capacityTeamNames,
            );
            activeCapacityScopeRef.current = capacityScopeSignature;

            const commitCapacityReadLifecycle = (event) => {
                const nextModel = reduceCapacityReadLifecycle(capacityReadModelRef.current, event);
                capacityReadModelRef.current = nextModel;
                capacityStateRef.current = nextModel.capacityState;
                setCapacityState(nextModel.capacityState);
                setCapacityLoading(nextModel.capacityLoading);
                setCapacityReadRevision(nextModel.capacityReadRevision);
                setCapacityReadError(nextModel.capacityReadError);
                setCapacityDataStale(nextModel.capacityDataStale);
            };

            const effectiveCapacityState = React.useMemo(() => (
                capacityState.scopeSignature === capacityScopeSignature
                    ? capacityState
                    : { capacityByTeam: {}, capacityTargetsByTeam: {}, capacityIssueCount: null, mutationEnabled: false, scopeSignature: capacityScopeSignature }
            ), [capacityState, capacityScopeSignature]);
            const { capacityByTeam, capacityTargetsByTeam } = effectiveCapacityState;
            const capacityMutationEnabled = effectiveCapacityState.mutationEnabled === true;

            const handleCapacitySaved = React.useCallback((result) => {
                if (result.scopeSignature !== activeCapacityScopeRef.current) return;
                setCapacityState((previous) => {
                    const nextState = applyCapacitySaveResultForScope(
                        previous,
                        result,
                        activeCapacityScopeRef.current,
                    );
                    capacityStateRef.current = nextState;
                    capacityReadModelRef.current = {
                        ...capacityReadModelRef.current,
                        capacityState: nextState,
                    };
                    return nextState;
                });
            }, []);
            const retryCapacity = React.useCallback(() => {
                setCapacityRefreshNonce(previous => previous + 1);
            }, []);
            const fetchCapacity = async ({ sprintName, teams, signal, scopeSignature, ownership }) => {
                try {
                    const response = await requestCapacity(BACKEND_URL, { sprintName, teams, signal });
                    if (!response.ok) throw new Error(`capacity_read_${response.status}`);
                    const data = await response.json();
                    if (!ownership.isCurrent()) return;
                    commitCapacityReadLifecycle({ type: 'success', scopeSignature, payload: data });
                } catch (error) {
                    if (error?.name === 'AbortError' || !ownership.isCurrent()) return;
                    commitCapacityReadLifecycle({ type: 'failure', scopeSignature });
                } finally {
                    if (!ownership.isCurrent()) return;
                    if (capacityReadAbortRef.current?.signal === signal) capacityReadAbortRef.current = null;
                }
            };

            useEffect(() => {
                const scopeSignature = capacityScopeSignature;
                const sprintName = selectedSprintInfo?.name || '';
                const ownership = beginCapacityReadOwnership({
                    generationRef: capacityReadGenerationRef,
                    abortRef: capacityReadAbortRef,
                    activeScopeRef: activeCapacityScopeRef,
                    scopeSignature,
                    capacityEnabled,
                    showPlanning,
                    sprintName,
                    teams: capacityTeamNames,
                });

                if (!ownership.shouldFetch) {
                    if (ownership.isCurrent()) {
                        commitCapacityReadLifecycle({ type: 'gate', scopeSignature });
                    }
                } else {
                    if (ownership.isCurrent()) {
                        commitCapacityReadLifecycle({ type: 'start', scopeSignature });
                    }
                    void fetchCapacity({
                        sprintName,
                        teams: capacityTeamNames,
                        signal: ownership.controller.signal,
                        scopeSignature,
                        ownership,
                    });
                }

                return ownership.cleanup;
            }, [capacityEnabled, showPlanning, capacityScopeSignature, capacityRefreshNonce]);

            const capacityTeamIds = React.useMemo(() => {
                return !isAllTeamsSelected
                    ? Array.from(selectedTeamSet)
                    : teamCapacityEntries.map(entry => entry.id);
            }, [isAllTeamsSelected, selectedTeamSet, teamCapacityEntries]);

            const getTeamCapacity = (teamName) => {
                if (!capacityEnabled) return 0;
                const resolved = resolveUniqueCapacityValue(capacityByTeam, teamName);
                return resolved.matched ? resolved.value : 0;
            };

            const excludedCapacityByTeamId = React.useMemo(() => {
                return buildExcludedCapacityByTeamId({
                    capacityEnabled,
                    showPlanning,
                    capacityTasks,
                    excludedEpicSet,
                    normalizeEpicKey,
                    getTeamInfo
                });
            }, [capacityEnabled, showPlanning, capacityTasks, excludedEpicSet]);

            const getTeamNetCapacity = (team) => {
                if (!capacityEnabled) return 0;
                const base = getTeamCapacity(team.name);
                const excluded = excludedCapacityByTeamId[team.id] || 0;
                return Math.max(0, base - excluded);
            };

            const capacityTotalsSummary = React.useMemo(() => {
                return buildCapacityTotalsSummary({
                    capacityEnabled,
                    displayedTeamOptions,
                    getTeamCapacity,
                    excludedCapacityByTeamId,
                    capacityMultiplier
                });
            }, [capacityEnabled, displayedTeamOptions, excludedCapacityByTeamId, capacityMultiplier, capacityByTeam]);
            const totalCapacityBase = capacityTotalsSummary.totalCapacityBase;
            const excludedCapacityTotal = capacityTotalsSummary.excludedCapacityTotal;
            const estimatedCapacityRaw = capacityTotalsSummary.estimatedCapacityRaw;
            const totalCapacityAdjusted = capacityTotalsSummary.totalCapacityAdjusted;
            const estimatedCapacityAdjusted = capacityTotalsSummary.estimatedCapacityAdjusted;
            const excludedCapacityAdjusted = capacityTotalsSummary.excludedCapacityAdjusted;
            const capacitySummary = getCapacityStatus(selectedSP, totalCapacityAdjusted);
            const scrollToFirstExcludedEpic = (projectType = 'any') => {
                const firstExcluded = epicGroups.find((epic) => {
                    if (!excludedEpicSet.has(normalizeEpicKey(epic.key))) return false;
                    if (projectType === 'any') return true;
                    const hasTech = (epic.tasks || []).some(task => techProjectKeys.has(String(task.fields?.projectKey || String(task.key || '').split('-')[0]).toUpperCase()));
                    const hasProduct = (epic.tasks || []).some(task => !techProjectKeys.has(String(task.fields?.projectKey || String(task.key || '').split('-')[0]).toUpperCase()));
                    return projectType === 'tech' ? hasTech : hasProduct;
                });
                if (!firstExcluded) return;
                const node = epicRefMap.current.get(firstExcluded.key);
                if (!node) return;
                node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                node.classList.remove('epic-flash');
                void node.offsetWidth;
                node.classList.add('epic-flash');
            };

            const projectCapacity = React.useMemo(() => {
                return buildProjectCapacity({
                    showPlanning,
                    capacityEnabled,
                    displayedTeamOptions,
                    selectedTeamProjectStats,
                    getTeamNetCapacity,
                    capacitySplit,
                    showProduct,
                    showTech
                });
            }, [
                showPlanning,
                capacityEnabled,
                displayedTeamOptions,
                selectedTeamProjectStats,
                showProduct,
                showTech,
                capacitySplit,
                capacityByTeam,
                excludedCapacityByTeamId
            ]);

            const selectedProjectEntries = React.useMemo(() => {
                return buildSelectedProjectEntries({
                    showPlanning,
                    selectedProjectStats,
                    capacityEnabled,
                    projectCapacity
                });
            }, [showPlanning, selectedProjectStats, capacityEnabled, projectCapacity]);

            const selectedTeamEntries = React.useMemo(() => {
                return buildSelectedTeamEntries({
                    showPlanning,
                    displayedTeamOptions,
                    selectedTeamStats,
                    capacityEnabled,
                    capacityByTeam,
                    capacityTargetsByTeam,
                    getTeamCapacity,
                    getTeamNetCapacity,
                    capacityMultiplier
                });
            }, [
                showPlanning,
                displayedTeamOptions,
                selectedTeamStats,
                capacityEnabled,
                capacityMultiplier,
                capacityByTeam,
                capacityTargetsByTeam,
                excludedCapacityByTeamId
            ]);

            const capacityTotals = React.useMemo(() => {
                return buildCapacityTotals({
                    showPlanning,
                    capacityEnabled,
                    displayedTeamCapacityEntries
                });
            }, [showPlanning, capacityEnabled, displayedTeamCapacityEntries]);

            const showTotalsRow = displayedTeamCapacityEntries.length > 1;

            const formatCapacityValue = (value) => {
                const num = Number(value || 0);
                return num.toFixed(1);
            };

            const renderPriorityIcon = (priority, idSeed) => {
                const name = String(priority || '').toLowerCase();
                const label = priority || 'None';
                const shortLabel = formatPriorityShort(priority);
                const priorityAttrs = { 'data-priority': label, 'data-priority-short': shortLabel, 'aria-label': label };
                const iconClass = name.replace(/\s+/g, '-') || 'none';
                const safeId = String(idSeed || 'priority').replace(/[^a-z0-9_-]/gi, '') || 'priority';
                const gradientId = `priority-grad-${safeId}`;
                if (!name) {
                    return (
                        <span className="task-priority-icon none" {...priorityAttrs}>
                            <svg viewBox="0 0 16 16">
                                <circle cx="8" cy="8" r="5" fill="none" stroke="#7a8699" strokeWidth="2"/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('blocker')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} {...priorityAttrs}>
                            <svg viewBox="0 0 16 16">
                                <path d="M8 15c-3.9 0-7-3.1-7-7s3.1-7 7-7 7 3.1 7 7-3.1 7-7 7zM4 7c-.6 0-1 .4-1 1s.4 1 1 1h8c.6 0 1-.4 1-1s-.4-1-1-1H4z" fill="#ff5630"/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('critical')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} {...priorityAttrs}>
                            <svg viewBox="0 0 16 16">
                                <defs>
                                    <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="-46.25" y1="65.1105" x2="-46.25" y2="64.1105" gradientTransform="matrix(12 0 0 -13.1121 563 854.7415)">
                                        <stop offset="0" stopColor="#ff5630"/>
                                        <stop offset="1" stopColor="#ff8f73"/>
                                    </linearGradient>
                                </defs>
                                <path d="M2.5 4l5-2.9c.3-.2.7-.2 1 0l5 2.9c.3.2.5.5.5.9v8.2c0 .6-.4 1-1 1-.2 0-.4 0-.5-.1L8 11.4 3.5 14c-.5.3-1.1.1-1.4-.4-.1-.1-.1-.3-.1-.5V4.9c0-.4.2-.7.5-.9z" fill={`url(#${gradientId})`}/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('highest') || name.includes('high') || name.includes('major')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} {...priorityAttrs}>
                            <svg viewBox="0 0 16 16">
                                <path d="M7.984436 3.200867l-4.5 2.7c-.5.3-1.1.1-1.3-.4s-.2-1.1.3-1.3l5-3c.3-.2.7-.2 1 0l5 3c.5.3.6.9.3 1.4-.3.5-.9.6-1.4.3l-4.4-2.7z" fill="#ff5630"/>
                                <path d="M3.484436 10.200867c-.5.3-1.1.1-1.3-.3s-.2-1.1.3-1.4l5-3c.3-.2.7-.2 1 0l5 3c.5.3.6.9.3 1.4-.3.5-.9.6-1.4.3l-4.4-2.7-4.5 2.7z" fill="#ff7452"/>
                                <path d="M3.484436 14.500867c-.5.3-1.1.2-1.3-.3s-.2-1.1.3-1.4l5-3c.3-.2.7-.2 1 0l5 3c.5.3.6.9.3 1.4-.3.5-.9.6-1.4.3l-4.4-2.7-4.5 2.7z" fill="#ff8f73"/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('medium')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} {...priorityAttrs}>
                            <svg viewBox="0 0 16 16">
                                <circle cx="8" cy="8" r="5" fill="none" stroke="#7a8699" strokeWidth="2"/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('minor') || name.includes('lowest')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} {...priorityAttrs}>
                            <svg viewBox="0 0 16 16">
                                <path d="M8.045319 12.806152l4.5-2.7c.5-.3 1.1-.1 1.3.4s.2 1.1-.3 1.3l-5 3c-.3.2-.7.2-1 0l-5-3c-.5-.3-.6-.9-.3-1.4.3-.5.9-.6 1.4-.3l4.4 2.7z" fill="#0065ff"/>
                                <path d="M12.545319 5.806152c.5-.3 1.1-.1 1.3.3s.2 1.1-.3 1.4l-5 3c-.3.2-.7.2-1 0l-5-3c-.5-.3-.6-.9-.3-1.4.3-.5.9-.6 1.4-.3l4.4 2.7 4.5-2.7z" fill="#2684ff"/>
                                <path d="M12.545319 1.506152c.5-.3 1.1-.2 1.3.3s.2 1.1-.3 1.4l-5 3c-.3.2-.7.2-1 0l-5-3c-.5-.3-.6-.9-.3-1.4.3-.5.9-.6 1.4-.3l4.4 2.7 4.5-2.7z" fill="#4c9aff"/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('low')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} {...priorityAttrs}>
                            <svg viewBox="0 0 16 16">
                                <path d="M12.5 6.1c.5-.3 1.1-.1 1.4.4.3.5.1 1.1-.3 1.3l-5 3c-.3.2-.7.2-1 0l-5-3c-.6-.2-.7-.9-.4-1.3.2-.5.9-.7 1.3-.4L8 8.8l4.5-2.7z" fill="#0065ff"/>
                            </svg>
                        </span>
                    );
                }
                return (
                    <span className={`task-priority-icon ${iconClass}`} {...priorityAttrs}>
                        <svg viewBox="0 0 16 16">
                            <circle cx="8" cy="8" r="5" fill="none" stroke="#7a8699" strokeWidth="2"/>
                        </svg>
                    </span>
                );
            };

            const getMetricClass = (value, type, acceptedValue) => {
                const num = Number(value || 0);
                if (num === 0) {
                    return 'metric-value metric-muted';
                }
                if (type === 'accepted') {
                    return 'metric-value metric-accepted';
                }
                if (type === 'todo' && acceptedValue !== undefined && acceptedValue < num) {
                    return 'metric-value metric-warn';
                }
                return 'metric-value';
            };

            // Stories under configured Ad Hoc epics count as Product even when they
            // live under a Tech project. Reuse the established epic-children pattern
            // ("Epic Link" OR parent) so Product links INCLUDE Ad Hoc stories and Tech
            // links EXCLUDE them. Ad Hoc handling only activates when capacityType is
            // passed and Ad Hoc epics are configured; all other callers are unchanged.
            const adHocEpicChildrenClause = () => {
                const keys = Array.from(adHocEpicSet);
                if (!keys.length) return '';
                const quoted = keys.map(k => `"${k}"`).join(', ');
                return `("Epic Link" in (${quoted}) OR parent in (${quoted}))`;
            };
            const buildTeamStatusLink = ({ teamId, teamIds, projectName, projectNames, statuses, excludeStatuses, priorityName, issueType, capacityType }) => {
                const ids = teamIds || (teamId ? [teamId] : []);
                if (!jiraUrl || !ids.length) return '';
                const clauses = [];
                const projects = projectNames || (projectName ? [projectName] : []);
                const adHocClause = capacityType ? adHocEpicChildrenClause() : '';
                let projectClause = '';
                if (projects.length === 1) {
                    projectClause = `project = "${projects[0]}"`;
                } else if (projects.length > 1) {
                    const quoted = projects.map(p => `"${p}"`).join(', ');
                    projectClause = `project in (${quoted})`;
                }
                if (capacityType === 'product' && projectClause && adHocClause) {
                    // Product link: include Ad Hoc stories even when under a Tech project.
                    clauses.push(`(${projectClause} OR ${adHocClause})`);
                } else if (capacityType === 'tech' && adHocClause) {
                    // Tech link: exclude Ad Hoc stories that would otherwise match Tech.
                    if (projectClause) clauses.push(projectClause);
                    clauses.push(`NOT ${adHocClause}`);
                } else if (projectClause) {
                    clauses.push(projectClause);
                }
                if (ids.length === 1) {
                    clauses.push(`"Team[Team]" = "${ids[0]}"`);
                } else {
                    const quotedTeams = ids.map(id => `"${id}"`).join(', ');
                    clauses.push(`"Team[Team]" in (${quotedTeams})`);
                }
                if (selectedSprint) {
                    clauses.push(`Sprint = ${selectedSprint}`);
                }
                if (statuses && statuses.length) {
                    if (statuses.length === 1) {
                        clauses.push(`status = "${statuses[0]}"`);
                    } else {
                        const quoted = statuses.map(s => `"${s}"`).join(', ');
                        clauses.push(`status in (${quoted})`);
                    }
                } else if (excludeStatuses && excludeStatuses.length) {
                    const quoted = excludeStatuses.map(s => `"${s}"`).join(', ');
                    clauses.push(`status not in (${quoted})`);
                }
                if (priorityName) {
                    clauses.push(`priority = "${priorityName}"`);
                }
                if (issueType) {
                    clauses.push(`issuetype = "${issueType}"`);
                }
                const jql = encodeURIComponent(clauses.join(' AND '));
                return `${jiraUrl}/issues/?jql=${jql}`;
            };

            const buildStatLink = (value, options) => {
                const count = Number(value || 0);
                if (!count) return '';
                return buildTeamStatusLink(options);
            };

            const buildPriorityStatusLink = ({ priorityName, statuses, excludeStatuses }) => {
                return buildTeamStatusLink({
                    teamIds: priorityTeamIds,
                    statuses,
                    excludeStatuses,
                    priorityName,
                    issueType: 'Story'
                });
            };

            const buildPriorityStatLink = (value, options) => {
                const count = Number(value || 0);
                if (!count) return '';
                return buildPriorityStatusLink(options);
            };

            // Planning capacity table rows are Product or Tech by their single roadmap
            // project; infer capacityType so Product links INCLUDE Ad Hoc stories and
            // Tech links EXCLUDE them. Total rows pass both projects -> no Ad Hoc shift.
            const inferRoadmapCapacityType = ({ projectName, projectNames, capacityType }) => {
                if (capacityType) return capacityType;
                if (projectNames && projectNames.length !== 1) return undefined;
                const single = projectName || (projectNames && projectNames[0]);
                if (single === 'PRODUCT ROADMAPS') return 'product';
                if (single === 'TECHNICAL ROADMAP') return 'tech';
                return undefined;
            };

            const buildPostponedLink = ({ teamId, teamIds, projectName, projectNames, capacityType }) => {
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['Postponed'], issueType: 'Story', capacityType: inferRoadmapCapacityType({ projectName, projectNames, capacityType }) });
            };

            const buildTodoPendingLink = ({ teamId, teamIds, projectName, projectNames, capacityType }) => {
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['To Do', 'Pending'], issueType: 'Story', capacityType: inferRoadmapCapacityType({ projectName, projectNames, capacityType }) });
            };

            const buildAcceptedLink = ({ teamId, teamIds, projectName, projectNames, capacityType }) => {
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['Accepted'], issueType: 'Story', capacityType: inferRoadmapCapacityType({ projectName, projectNames, capacityType }) });
            };

            const buildKeyListLink = (keys, { addSprint } = {}) => {
                if (!jiraUrl) return '';
                const list = (keys || []).filter(Boolean);
                if (!list.length) return '';
                const clauses = [`key in (${list.join(', ')})`];
                if (addSprint && selectedSprint) {
                    clauses.push(`Sprint = ${selectedSprint}`);
                }
                const jql = encodeURIComponent(clauses.join(' AND '));
                return `${jiraUrl}/issues/?jql=${jql}`;
            };

            const hasStoryPoints = (task) => {
                const sp = task.fields.customfield_10004;
                if (sp === null || sp === undefined || sp === '') {
                    return false;
                }
                const numeric = parseFloat(sp);
                return !Number.isNaN(numeric) && numeric > 0;
            };

            const isExcludedStatus = (status) => status === 'killed' || status === 'postponed' || status === 'done';
            const isTaskInSelectedSprint = (task) => {
                if (!selectedSprint) return false;
                return issueMatchesSelectedSprint(task, {
                    selectedSprint,
                    selectedSprintName: selectedSprintInfo?.name || ''
                });
            };
            const resolveDependencyStatus = (dep) => {
                if (!dep?.key) return '';
                const issue = issueByKey.get(dep.key);
                const lookup = dependencyLookupCache[dep.key];
                return normalizeStatus(
                    issue?.fields?.status?.name ||
                    issue?.status?.name ||
                    issue?.status ||
                    lookup?.status ||
                    dep.status
                );
            };
            const getBlockedAlertStatusLabel = (task) => {
                const baseLabel = task.fields.status?.name || 'Blocked';
                const entries = (dependencyData[task.key] || [])
                    .filter(dep => dep.category === 'block' && dep.dependentKey === task.key);
                if (!entries.length) return baseLabel;
                const blockersDone = entries.every(dep => resolveDependencyStatus(dep) === 'done');
                return blockersDone ? 'Unblocked' : baseLabel;
            };
            const dismissedAlertSet = React.useMemo(() => new Set(dismissedAlertKeys || []), [dismissedAlertKeys]);

            const blockedTasks = visibleTasks.filter(task => {
                const status = normalizeStatus(task.fields.status?.name);
                if (!status) return false;
                if (isExcludedStatus(status)) return false;
                if (dismissedAlertSet.has(task.key)) return false;
                return status.includes('blocked');
            });

            const consolidatedMissingStories = React.useMemo(() => {
                const byKey = new Map();
                const shouldIncludeUnknownTeam = (task, missing) => {
                    const teamMissing = !task?.fields?.teamId && !task?.fields?.teamName;
                    if (!teamMissing) return true;
                    return true;
                };

                const shouldIncludeByTeam = (task) => {
                    if (isAllTeamsSelected) return true;
                    const teamId = task?.fields?.teamId;
                    const teamName = task?.fields?.teamName;
                    if (!teamId && !teamName) {
                        return true; // can't filter reliably, keep it visible
                    }
                    return selectedTeamSet.has(getTeamInfo(task).id);
                };

                const excluded = (task) => {
                    if (!task?.key) return true;
                    if (dismissedAlertSet.has(task.key)) return true;
                    const status = normalizeStatus(task.fields.status?.name);
                    return status === 'killed' || status === 'done' || status === 'postponed';
                };

                // Start with server-provided missing info, but only keep items in the selected sprint.
                (missingPlanningInfoTasks || []).forEach((task) => {
                    if (!task?.key || excluded(task) || !shouldIncludeByTeam(task)) return;
                    if (!isTaskInSelectedSprint(task)) return;
                    const missing = new Set(task.fields?.missingFields || []);
                    if (!shouldIncludeUnknownTeam(task, missing)) return;
                    if (missing.size === 0) return;
                    byKey.set(task.key, { task, missing });
                });

                // Merge client-side checks (covers missing Story Points / Epic / Team)
                visibleTasks.forEach((task) => {
                    if (!task?.key || excluded(task) || !shouldIncludeByTeam(task)) return;
                    const current = byKey.get(task.key) || { task, missing: new Set() };

                    if (!hasStoryPoints(task)) current.missing.add('Story Points');
                    if (!task.fields?.epicKey) current.missing.add('Epic');
                    if (!task.fields?.teamId && !task.fields?.teamName) current.missing.add('Team');
                    if (!shouldIncludeUnknownTeam(task, current.missing)) return;

                    if (current.missing.size > 0) {
                        // Prefer the server task object if present (may carry extra fields)
                        current.task = current.task || task;
                        byKey.set(task.key, current);
                    }
                });

                return [...byKey.values()]
                    .map(({ task, missing }) => ({ task, missingFields: [...missing] }))
                    .sort((a, b) => {
                        const diff = b.missingFields.length - a.missingFields.length;
                        if (diff !== 0) return diff;
                        const priorityA = priorityOrder[a.task.fields.priority?.name] || 999;
                        const priorityB = priorityOrder[b.task.fields.priority?.name] || 999;
                        if (priorityA !== priorityB) return priorityA - priorityB;
                        return (a.task.fields.summary || '').localeCompare(b.task.fields.summary || '');
                    });
            }, [
                missingPlanningInfoTasks,
                visibleTasks,
                isAllTeamsSelected,
                selectedTeamSet,
                dismissedAlertKeys,
                selectedSprint,
                selectedSprintInfo?.name
            ]);

            const normalizedActiveGroupTeamLabels = React.useMemo(() => {
                const entries = Object.entries(activeGroupTeamLabels || {})
                    .map(([teamId, aliases]) => [String(teamId || '').trim(), normalizeTeamLabelAliases(aliases)])
                    .filter(([teamId, aliases]) => teamId && aliases.length);
                return Object.fromEntries(entries);
            }, [activeGroupTeamLabels]);
            const getFuturePlanningTeamInfos = React.useCallback((epic) => {
                return getFuturePlanningEpicTeamInfos(epic, {
                    selectedTeamSet,
                    teamLabels: normalizedActiveGroupTeamLabels,
                    resolveTeamName,
                    fallbackSelectedTeamName: selectedTeamSet.size === 1 ? (teamNameById.get(Array.from(selectedTeamSet)[0]) || '') : '',
                    teamNameById
                });
            }, [selectedTeamSet, normalizedActiveGroupTeamLabels, resolveTeamName, teamNameById]);
            const storiesByEpicKey = React.useMemo(() => {
                const map = new Map();
                tasks.forEach((task) => {
                    const epicKey = task.fields?.epicKey;
                    if (!epicKey) return;
                    if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return;
                    const list = map.get(epicKey) || [];
                    list.push(task);
                    map.set(epicKey, list);
                });
                return map;
            }, [tasks, isAllTeamsSelected, selectedTeamSet]);
            const epicMatchesPlanningSprintValue = React.useCallback((epic) => {
                return epicMatchesSelectedSprint(epic, {
                    selectedSprint,
                    selectedSprintName: selectedSprintInfo?.name || ''
                });
            }, [selectedSprint, selectedSprintInfo?.name]);
            const epicHasPlanningSprintLabel = React.useCallback((epic) => {
                return epicHasSelectedSprintLabel(epic, selectedSprintInfo?.name || '');
            }, [selectedSprintInfo?.name]);
            // While the Department is too large for Epic alerts, epicsInScope holds only the primary load's
            // first page; no alert may be derived from it. Separate sources (remote Backlog, sprint Stories,
            // ready-to-close Epics, Story readiness) are unaffected.
            const alertEpicsInScope = React.useMemo(
                () => (alertScopeTooLarge ? [] : epicsInScope),
                [alertScopeTooLarge, epicsInScope]
            );
            const planningCandidateEpics = React.useMemo(() => {
                return alertEpicsInScope.filter((epic) => {
                    if (!epic?.key) return false;
                    if (dismissedAlertSet.has(epic.key)) return false;
                    const status = normalizeStatus(epic.status?.name);
                    if (!status || status === 'done' || status === 'killed' || status === 'incomplete') return false;
                    if (!epicMatchesFuturePlanningTeamSelection(epic, {
                        isAllTeamsSelected,
                        selectedTeamSet,
                        teamLabels: normalizedActiveGroupTeamLabels
                    })) return false;
                    return true;
                });
            }, [alertEpicsInScope, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet, normalizedActiveGroupTeamLabels]);
            const backlogEpics = React.useMemo(() => {
                if (!isFutureSprintSelected) return [];
                const seen = new Set();
                const selectedSprintScope = { selectedSprint, selectedSprintName: selectedSprintInfo?.name || '' };
                const remoteBacklog = filterExplicitBacklogEpics([...backlogProductEpics, ...backlogTechEpics], selectedSprintScope);
                const sprintValueBacklog = filterExplicitBacklogEpics(planningCandidateEpics, selectedSprintScope);
                return [...remoteBacklog, ...sprintValueBacklog].filter((epic) => {
                    if (!epic?.key || seen.has(epic.key)) return false;
                    seen.add(epic.key);
                    if (dismissedAlertSet.has(epic.key)) return false;
                    if (!epicMatchesFuturePlanningTeamSelection(epic, {
                        isAllTeamsSelected,
                        selectedTeamSet,
                        teamLabels: normalizedActiveGroupTeamLabels
                    })) return false;
                    const status = normalizeStatus(epic.status?.name);
                    if (!status || status === 'done' || status === 'killed' || status === 'incomplete') return false;
                    return true;
                });
            }, [isFutureSprintSelected, backlogProductEpics, backlogTechEpics, planningCandidateEpics, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet, normalizedActiveGroupTeamLabels, selectedSprint, selectedSprintInfo?.name]);
            const backlogEpicKeySet = React.useMemo(
                () => new Set(backlogEpics.map(epic => epic.key).filter(Boolean)),
                [backlogEpics]
            );
            const missingTeamEpics = React.useMemo(() => {
                if (!isFutureSprintSelected) return [];
                return planningCandidateEpics.filter((epic) => {
                    if (backlogEpicKeySet.has(epic.key)) return false;
                    const teamId = String(epic.teamId || '').trim();
                    const teamName = String(epic.teamName || '').trim().toLowerCase();
                    return !teamId || !teamName || teamName === 'unknown team';
                });
            }, [isFutureSprintSelected, planningCandidateEpics, backlogEpicKeySet]);
            const missingTeamEpicKeySet = React.useMemo(
                () => new Set(missingTeamEpics.map(epic => epic.key).filter(Boolean)),
                [missingTeamEpics]
            );
            const missingLabelEpics = React.useMemo(() => {
                if (!isFutureSprintSelected) return [];
                return planningCandidateEpics.filter((epic) => {
                    if (backlogEpicKeySet.has(epic.key) || missingTeamEpicKeySet.has(epic.key)) return false;
                    if (!epicMatchesPlanningSprintValue(epic)) return false;
                    return !epicHasPlanningSprintLabel(epic) || !epicHasFuturePlanningTeamLabel(epic, {
                        selectedTeamSet,
                        teamLabels: normalizedActiveGroupTeamLabels
                    });
                });
            }, [isFutureSprintSelected, planningCandidateEpics, backlogEpicKeySet, missingTeamEpicKeySet, selectedTeamSet, normalizedActiveGroupTeamLabels, epicMatchesPlanningSprintValue, epicHasPlanningSprintLabel]);
            const missingLabelEpicKeySet = React.useMemo(
                () => new Set(missingLabelEpics.map(epic => epic.key).filter(Boolean)),
                [missingLabelEpics]
            );
            const storyReadinessAlerts = React.useMemo(() => buildStoryReadinessAlertModel({
                selectedSprintState, dismissedIds: dismissedStoryRequirementIds,
                alertTargets: engWorkHierarchy.alertTargets || [], isFutureSprintSelected,
                backlogEpicKeys: backlogEpicKeySet, missingTeamEpicKeys: missingTeamEpicKeySet,
                missingLabelEpicKeys: missingLabelEpicKeySet, normalizeStatus,
            }), [selectedSprintState, dismissedStoryRequirementIds, engWorkHierarchy.alertTargets, isFutureSprintSelected, backlogEpicKeySet, missingTeamEpicKeySet, missingLabelEpicKeySet]);
            const needsStoriesEntries = storyReadinessAlerts.entries;
            const needsStoriesEpics = storyReadinessAlerts.epics;
            const storyReadinessEpicKeySet = storyReadinessAlerts.epicKeySet;

            const emptyEpics = alertEpicsInScope
                .filter(epic => {
                    const status = normalizeStatus(epic.status?.name);
                    if (status === 'killed' || status === 'done' || status === 'incomplete' || status === 'in progress') return false;
                    if (!isAllTeamsSelected && epic.teamId && !selectedTeamSet.has(epic.teamId)) return false;
                    return true;
                })
                .filter(epic => typeof epic.totalStories === 'number' && epic.totalStories === 0)
                .filter(epic => !dismissedAlertSet.has(epic.key));
            const futureRoutedEpics = React.useMemo(() => {
                return emptyEpics.filter(epic => {
                    const selectedStories = Number(epic.selectedStories || 0);
                    const futureOpenStories = Number(epic.futureOpenStories || 0);
                    return selectedStories === 0 && futureOpenStories > 0;
                });
            }, [emptyEpics]);

            const readyToCloseStoryStatuses = new Set(['done', 'killed', 'incomplete']);
            const readyToCloseEpicStatuses = new Set(['in progress', 'accepted']);
            const matchesSelectedSprint = epicMatchesPlanningSprintValue;
            const epicHasStoryInSelectedSprint = (epicStories) => {
                if (!epicStories || epicStories.length === 0) return false;
                return epicStories.some(task => isTaskInSelectedSprint(task));
            };
            const epicOrStoriesMatchSelectedSprint = (epic, epicStories) => {
                if (matchesSelectedSprint(epic)) return true;
                return epicHasStoryInSelectedSprint(epicStories);
            };

            const doneStoryEpics = readyToCloseEpicsInScope
                .filter(epic => {
                    const status = normalizeStatus(epic.status?.name);
                    if (!readyToCloseEpicStatuses.has(status)) return false;
                    if (!isAllTeamsSelected && epic.teamId && !selectedTeamSet.has(epic.teamId)) return false;
                    return true;
                })
                .filter(epic => {
                    const epicStories = tasks.filter(task => {
                        if (!task.fields?.epicKey) return false;
                        if (task.fields.epicKey !== epic.key) return false;
                        if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                        return true;
                    });
                    if (epicStories.length === 0) return false;
                    if (!epicOrStoriesMatchSelectedSprint(epic, epicStories)) return false;
                    // Authoritative, truncation-free signal from the backend: ready to
                    // close only when the epic has zero open (non-terminal) children
                    // across all sprints. Fail closed when the count is missing/unloaded
                    // so a still-open future-sprint story is never read as "all done".
                    return epic.openChildCount === 0;
                })
                .filter(epic => !dismissedAlertSet.has(epic.key));

            const analysisEpicsSource = React.useMemo(() => {
                const seen = new Set();
                const merged = [...readyToCloseEpicsInScope, ...alertEpicsInScope].filter(epic => {
                    if (!epic?.key) return false;
                    if (seen.has(epic.key)) return false;
                    seen.add(epic.key);
                    return true;
                });
                return merged;
            }, [readyToCloseEpicsInScope, alertEpicsInScope]);

            const sortByPriorityThenSummary = (a, b) => {
                const priorityA = priorityOrder[a.fields.priority?.name] || 999;
                const priorityB = priorityOrder[b.fields.priority?.name] || 999;
                if (priorityA !== priorityB) return priorityA - priorityB;
                return (a.fields.summary || '').localeCompare(b.fields.summary || '');
            };

            const groupAlertsByTeam = (items, resolveTeam, sortItems) => {
                const groups = new Map();
                (items || []).forEach(item => {
                    const teams = [].concat(resolveTeam(item) || []).filter(Boolean);
                    if (!teams.length) teams.push({ id: 'unknown', name: 'Unknown Team' });
                    const seenTeamIds = new Set();
                    teams.forEach((team) => {
                        const id = team.id || team.name || 'unknown';
                        if (seenTeamIds.has(id)) return;
                        seenTeamIds.add(id);
                        const entry = groups.get(id) || { id, name: team.name || 'Unknown Team', items: [] };
                        entry.items.push(item);
                        groups.set(id, entry);
                    });
                });
                const list = Array.from(groups.values());
                list.forEach(group => sortItems && group.items.sort(sortItems));
                return list.sort((a, b) => a.name.localeCompare(b.name));
            };

            const postponedTasks = React.useMemo(() => {
                return tasks.filter(task => {
                    if (!task?.key) return false;
                    if (dismissedAlertSet.has(task.key)) return false;
                    const status = normalizeStatus(task.fields.status?.name);
                    if (status !== 'postponed') return false;
                    if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                    return true;
                });
            }, [tasks, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet]);

            const analysisWaitingEpics = React.useMemo(() => {
                return analysisEpicsSource.filter(epic => {
                    if (!epic?.key) return false;
                    if (dismissedAlertSet.has(epic.key)) return false;
                    const status = normalizeStatus(epic.status?.name);
                    if (readyToCloseEpicStatuses.has(status)) return false;
                    if (status === 'killed' || status === 'done' || status === 'incomplete') return false;
                    if (!isAllTeamsSelected && epic.teamId && !selectedTeamSet.has(epic.teamId)) return false;
                    const selectedSprintEpicStories = tasks.filter(task => {
                        if (!task.fields?.epicKey) return false;
                        if (task.fields.epicKey !== epic.key) return false;
                        if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                        return true;
                    });
                    // Waiting for Stories must only surface epics that belong to the currently selected sprint.
                    if (!epicOrStoriesMatchSelectedSprint(epic, selectedSprintEpicStories)) return false;
                    const epicStories = readyToCloseTasks.filter(task => {
                        if (!task.fields?.epicKey) return false;
                        if (task.fields.epicKey !== epic.key) return false;
                        if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                        return true;
                    });
                    if (epicStories.length === 0) return false;
                    return epicStories.every(task => readyToCloseStoryStatuses.has(normalizeStatus(task.fields.status?.name)));
                });
            }, [
                analysisEpicsSource,
                dismissedAlertSet,
                isAllTeamsSelected,
                selectedTeamSet,
                tasks,
                readyToCloseTasks,
                readyToCloseStoryStatuses,
                readyToCloseEpicStatuses,
                selectedSprint,
                selectedSprintInfo?.name
            ]);

            const postponedEmptyEpics = React.useMemo(() => {
                return emptyEpics.filter(epic => {
                    const status = normalizeStatus(epic.status?.name);
                    if (status !== 'postponed') return false;
                    if (!isFutureSprintSelected) return false;
                    return matchesSelectedSprint(epic);
                });
            }, [emptyEpics, isFutureSprintSelected, selectedSprint, selectedSprintInfo?.name]);
            const epicsWithActionableStoriesInSelectedSprint = React.useMemo(() => {
                const storiesByEpic = new Map();
                selectionTasks.forEach(task => {
                    const epicKey = task.fields?.epicKey;
                    if (!epicKey) return;
                    const status = normalizeStatus(task.fields.status?.name);
                    if (!status) return;
                    if (status.includes('blocked')) return;
                    if (status === 'killed' || status === 'done' || status === 'incomplete') return;
                    const list = storiesByEpic.get(epicKey) || [];
                    list.push(task);
                    storiesByEpic.set(epicKey, list);
                });
                const epicKeys = new Set();
                emptyEpics.forEach(epic => {
                    if (!epic?.key) return;
                    const epicStories = storiesByEpic.get(epic.key) || [];
                    if (!epicStories.length) return;
                    if (matchesSelectedSprint(epic) || epicHasStoryInSelectedSprint(epicStories)) {
                        epicKeys.add(epic.key);
                    }
                });
                return epicKeys;
            }, [selectionTasks, emptyEpics, selectedSprint, selectedSprintInfo?.name]);

            const emptyEpicsForAlert = React.useMemo(() => {
                if (isFutureSprintSelected) return [];
                const futureRoutedEpicKeys = new Set(futureRoutedEpics.map(epic => epic.key).filter(Boolean));
                return emptyEpics.filter(epic => {
                    if (!epic?.key) return false;
                    if (storyReadinessEpicKeySet.has(epic.key)) return false;
                    if (Number(epic.selectedActionableStories || 0) > 0) return false;
                    if (epicsWithActionableStoriesInSelectedSprint.has(epic.key)) return false;
                    if (futureRoutedEpicKeys.has(epic.key)) return false;
                    return true;
                });
            }, [isFutureSprintSelected, emptyEpics, epicsWithActionableStoriesInSelectedSprint, futureRoutedEpics, storyReadinessEpicKeySet]);
            const waitingForStoriesEpics = React.useMemo(() => {
                if (isFutureSprintSelected) {
                    return [];
                }
                const seen = new Set();
                const merged = [...analysisWaitingEpics, ...postponedEmptyEpics].filter(epic => {
                    if (!epic?.key) return false;
                    if (storyReadinessEpicKeySet.has(epic.key)) return false;
                    if (seen.has(epic.key)) return false;
                    seen.add(epic.key);
                    return true;
                });
                return merged;
            }, [isFutureSprintSelected, analysisWaitingEpics, postponedEmptyEpics, storyReadinessEpicKeySet]);

            const {
                visibleAlertCollections,
                missingAlertKeySet,
                blockedAlertKeySet,
                postponedAlertKeySet,
                backlogAlertKeySet,
                needsStoriesAlertKeySet,
                waitingAlertKeySet,
                emptyAlertKeySet,
                doneAlertKeySet,
                alertCounts,
                alertItemCount,
            } = useEngAlertFilters({
                collections: {
                    consolidatedMissingStories,
                    blockedTasks,
                    postponedTasks,
                    futureRoutedEpics,
                    backlogEpics,
                    missingTeamEpics,
                    missingLabelEpics,
                    needsStoriesEntries,
                    needsStoriesEpics,
                    waitingForStoriesEpics,
                    emptyEpicsForAlert,
                    doneStoryEpics,
                },
                visibleTasks: visibleTasksForList,
                searchQuery,
                epicDetails,
                filters: engCatchUpFilters,
                techProjectKeys,
                focusedFilterActive: Boolean(burnoutTaskFilter),
            });

            const missingAlertTeams = groupAlertsByTeam(visibleAlertCollections.consolidatedMissingStories, (item) => getTeamInfo(item.task));
            const blockedAlertTeams = groupAlertsByTeam(visibleAlertCollections.blockedTasks, (task) => getTeamInfo(task), sortByPriorityThenSummary);
            const doneEpicTeams = groupAlertsByTeam(visibleAlertCollections.doneStoryEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const postponedAlertTeams = groupAlertsByTeam(visibleAlertCollections.postponedTasks, (task) => getTeamInfo(task), sortByPriorityThenSummary);
            const postponedEpicTeams = groupAlertsByTeam(visibleAlertCollections.futureRoutedEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const emptyEpicTeams = groupAlertsByTeam(visibleAlertCollections.emptyEpicsForAlert, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const analysisEpicTeams = groupAlertsByTeam(visibleAlertCollections.waitingForStoriesEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const backlogEpicTeams = groupAlertsByTeam(visibleAlertCollections.backlogEpics, (epic) => isFutureSprintSelected ? getFuturePlanningTeamInfos(epic) : getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const missingTeamEpicTeams = groupAlertsByTeam(visibleAlertCollections.missingTeamEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const missingLabelEpicTeams = groupAlertsByTeam(visibleAlertCollections.missingLabelEpics, (epic) => isFutureSprintSelected ? getFuturePlanningTeamInfos(epic) : getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const needsStoriesTeams = groupAlertsByTeam(visibleAlertCollections.needsStoriesEntries, (entry) => entry.team, (a, b) => (a.epic.summary || '').localeCompare(b.epic.summary || ''));

            const triggerAlertCelebration = React.useCallback((options = {}) => {
                if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    return;
                }
                const palettes = {
                    missing: ['#f97316', '#f59e0b', '#fbbf24', '#fb923c'],
                    blocked: ['#ef4444', '#f43f5e', '#f97316', '#f59e0b'],
                    followup: ['#6366f1', '#60a5fa', '#38bdf8', '#a855f7'],
                    waiting: ['#6366f1', '#60a5fa', '#38bdf8', '#a855f7'],
                    empty: ['#f59e0b', '#fbbf24', '#fde047', '#facc15'],
                    done: ['#22c55e', '#10b981', '#14b8a6', '#0ea5e9']
                };
                const types = options.types && options.types.length ? options.types : ['missing', 'blocked', 'followup', 'waiting', 'empty', 'done'];
                const palette = types.flatMap(type => palettes[type] || []).filter(Boolean);
                const colors = palette.length ? palette : ['#f97316', '#f59e0b', '#22c55e', '#0ea5e9', '#a855f7', '#14b8a6'];
                const count = options.count || (28 + Math.floor(Math.random() * 14));
                const shapes = ['square', 'round', 'triangle'];
                const now = Date.now();
                const pieces = Array.from({ length: count }).map((_, index) => {
                    const size = 6 + Math.random() * 8;
                    const height = size * (0.6 + Math.random() * 0.9);
                    const shape = shapes[Math.floor(Math.random() * shapes.length)];
                    return {
                        id: `${now}-${index}`,
                        left: Math.random() * 100,
                        size,
                        height,
                        delay: Math.random() * 0.35,
                        duration: 2.2 + Math.random() * 1.2,
                        drift: (Math.random() * 2 - 1) * 140,
                        rotate: (Math.random() * 2 - 1) * 540,
                        color: colors[index % colors.length],
                        shape
                    };
                });
                setAlertCelebrationPieces(pieces);
                if (alertCelebrationTimeoutRef.current) {
                    window.clearTimeout(alertCelebrationTimeoutRef.current);
                }
                const maxDuration = pieces.reduce((max, piece) => Math.max(max, piece.duration + piece.delay), 0);
                const timeoutMs = Math.max(2400, Math.ceil((maxDuration + 0.4) * 1000));
                alertCelebrationTimeoutRef.current = window.setTimeout(() => {
                    setAlertCelebrationPieces([]);
                }, timeoutMs);
            }, []);

            useEffect(() => {
                if (alertCelebrationTimeoutRef.current) {
                    window.clearTimeout(alertCelebrationTimeoutRef.current);
                }
                setAlertCelebrationPieces([]);
            }, [selectedSprint, activeGroupId, selectedTeams]);

            useEffect(() => {
                return () => {
                    if (alertCelebrationTimeoutRef.current) {
                        window.clearTimeout(alertCelebrationTimeoutRef.current);
                    }
                    if (alertHighlightTimeoutRef.current) {
                        window.clearTimeout(alertHighlightTimeoutRef.current);
                    }
                    if (alertStabilizeFrameRef.current) {
                        window.cancelAnimationFrame(alertStabilizeFrameRef.current);
                    }
                };
            }, []);

            useEffect(() => {
                const node = headerRef.current;
                if (!node) return;
                const updateVisibility = (rect) => {
                    if (!rect) return;
                    setCompactStickyVisible(rect.bottom <= 0);
                };
                const syncFromNode = () => updateVisibility(node.getBoundingClientRect());
                syncFromNode();
                if (typeof IntersectionObserver !== 'undefined') {
                    const observer = new IntersectionObserver((entries) => {
                        updateVisibility(entries[0]?.boundingClientRect);
                    }, {
                        threshold: [0, 1]
                    });
                    observer.observe(node);
                    window.addEventListener('resize', syncFromNode);
                    return () => {
                        observer.disconnect();
                        window.removeEventListener('resize', syncFromNode);
                    };
                }
                window.addEventListener('scroll', syncFromNode, { passive: true });
                window.addEventListener('resize', syncFromNode);
                return () => {
                    window.removeEventListener('scroll', syncFromNode);
                    window.removeEventListener('resize', syncFromNode);
                };
            }, []);

            useEffect(() => {
                if (!compactStickyVisible) {
                    setCompactHeaderOffset(0);
                    return;
                }
                const node = compactHeaderRef.current;
                if (!node) return;
                const updateOffset = () => {
                    const height = node.getBoundingClientRect().height || 0;
                    setCompactHeaderOffset(height);
                };
                updateOffset();
                let ro;
                if (typeof ResizeObserver !== 'undefined') {
                    ro = new ResizeObserver(updateOffset);
                    ro.observe(node);
                }
                window.addEventListener('resize', updateOffset);
                return () => {
                    window.removeEventListener('resize', updateOffset);
                    if (ro) ro.disconnect();
                };
            }, [compactStickyVisible]);

            useEffect(() => {
                setShowTeamDropdown(false);
                setShowSprintDropdown(false);
                setSprintActiveOptionIndex(0);
                sprintSelectorOriginRef.current = null;
                setShowGroupDropdown(false);
                setShowEpmProjectDropdown(false);
                setShowEpmSubGoalFilterDropdown(false);
                setShowEpmSortDropdown(false);
            }, [compactStickyVisible]);

            useEffect(() => {
                if (!showPlanning) {
                    setPlanningOffset(0);
                    return;
                }
                const node = planningPanelRef.current;
                if (!node) return;
                const updateOffset = () => {
                    const height = node.getBoundingClientRect().height || 0;
                    setPlanningOffset(height);
                };
                updateOffset();
                // ResizeObserver catches content changes and CSS transitions
                let ro;
                if (typeof ResizeObserver !== 'undefined') {
                    ro = new ResizeObserver(updateOffset);
                    ro.observe(node);
                }
                window.addEventListener('resize', updateOffset);
                return () => {
                    window.removeEventListener('resize', updateOffset);
                    if (ro) ro.disconnect();
                };
            }, [showPlanning, selectedCount, selectedSP, teamCapacityEntries.length, capacityEnabled, totalCapacityAdjusted, selectedTeamEntries.length, planningLayout]);

            // Detect when planning panel is sticky (stuck to viewport top)
            useEffect(() => {
                if (!showPlanning) { setIsPlanningStuck(false); return; }
                const node = planningPanelRef.current;
                if (!node) return;
                const check = () => {
                    const rect = node.getBoundingClientRect();
                    const stickyTop = (compactStickyVisible ? compactHeaderOffset : 0) + filterBarHeight;
                    setIsPlanningStuck(rect.top <= stickyTop);
                };
                check();
                window.addEventListener('scroll', check, { passive: true });
                return () => window.removeEventListener('scroll', check);
            }, [compactHeaderOffset, compactStickyVisible, showPlanning, planningLayout, filterBarHeight]);

            const openSelectedInJira = () => {
                const keys = capacityTasks
                    .filter(task => selectedTasks[task.key])
                    .map(task => task.key);
                openJiraIssueSearch({ jiraUrl, keys });
            };

            const activeControlSurface = compactStickyVisible ? 'compact' : 'main';
            const handleFilterBarHeightChange = React.useCallback(setFilterBarHeight, []);
            const containerStyle = {
                '--compact-header-offset': `${compactStickyTop}px`,
                '--planning-offset': `${planningStickyHeight}px`,
                '--planning-sticky-top': `${compactStickyTop + filterBarHeight}px`,
                '--filterbar-sticky-top': `${filterBarStickyTop}px`,
                '--epic-sticky-top': `${epicStickyTop}px`,
                '--scenario-sticky-top': `${epicStickyTop}px`
            };
            const showGroupControl = (visibleControlGroups || []).length > 1; const searchActive = Boolean(String(searchInput || searchQuery || '').trim()); const searchPanelActive = searchActive || searchFocused;
            const clearEngFacetFilters = React.useCallback(() => resetEngFacetFilters({ setEngStatusFilter, setEngPriorityFilter, setEngProjectTrackFilter, defaultEngStatusFilter: DEFAULT_ENG_STATUS_FILTER, setShowTech, setShowProduct }), []);
            const clearStoryRequirementHidingFilters = React.useCallback(() => {
                setSearchInput('');
                setSearchQuery('');
                setBurnoutTaskFilter(null);
                resetEngFacetFilters({
                    setEngStatusFilter,
                    setEngPriorityFilter,
                    setEngProjectTrackFilter,
                    defaultEngStatusFilter: null,
                    setShowTech,
                    setShowProduct,
                });
            }, []);
            const handleStoryRequirementClick = React.useCallback((entry) => {
                if (!entry?.id) return;
                setStoryRequirementNavigationError('');
                navigateToStoryRequirement({
                    requirementId: entry.id,
                    clearHidingFilters: clearStoryRequirementHidingFilters,
                    prefersReducedMotion,
                    onMissing: () => setStoryRequirementNavigationError('The Story requirement could not be revealed. Retry Story readiness or adjust the selected Department.'),
                });
            }, [clearStoryRequirementHidingFilters]);
            const dismissStoryRequirement = React.useCallback((entry) => {
                if (!entry?.id) return;
                setDismissedStoryRequirementIds(previous => previous.includes(entry.id) ? previous : [...previous, entry.id]);
            }, []);
            useEffect(() => {
                const scopeKey = `${activeGroupId || ''}::${selectedSprint || ''}`;
                if (storyRequirementScopeRef.current && storyRequirementScopeRef.current !== scopeKey) {
                    setDismissedStoryRequirementIds([]);
                    setStoryRequirementNavigationError('');
                }
                storyRequirementScopeRef.current = scopeKey;
            }, [activeGroupId, selectedSprint]);
            const clearEngFilters = React.useCallback(() => resetEngFilters({ setSearchInput, setSearchQuery, setSelectedTeams, setEngStatusFilter, setEngPriorityFilter, setEngProjectTrackFilter, defaultEngStatusFilter: DEFAULT_ENG_STATUS_FILTER, setShowTech, setShowProduct, setGroupByInitiativeChoice, setBurnoutTaskFilter, setShowTeamDropdown, setShowGroupDropdown, setShowSprintDropdown, trackFilterChanged, visibleCountBucket: bucketCount(visibleTasksForList.length) }), [trackFilterChanged, visibleTasksForList.length]);
            const trackStatsAnalyticsAction = (eventName, params = {}) => trackStatsAction(eventName, statsView, params);
            const renderSearchControl = (surface, extraClassName = '') => (
                <ControlField label="Search" className={`control-search ${searchActive ? 'active-filter applied-filter' : ''} ${extraClassName}`.trim()}>
                    <div className="search-wrap">
                        <input
                            data-onboarding-target="search"
                            data-onboarding-surface={surface}
                            type="text"
                            className="search-input"
                            placeholder="Search tickets..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
                            ref={searchInputRef}
                        />
                        {searchInput && (
                            <button
                                className="search-clear"
                                onClick={() => setSearchInput('')}
                                title="Clear search"
                                aria-label="Clear search"
                                type="button"
                            >
                                ×
                            </button>
                        )}
                    </div>
                </ControlField>
            );

            const renderViewSwitch = () => {
                if (!showEpmNavigation) return null;
                return (
                    <SegmentedControl
                        className="view-mode-control"
                        ariaLabel="Dashboard view"
                        value={selectedView}
                        onChange={(nextView) => {
                            trackSelectContent('dashboard_view', nextView, { from_view: currentDashboardView() });
                            setSelectedView(nextView);
                        }}
                        options={[
                            { value: 'eng', label: 'ENG' },
                            { value: 'epm', label: 'EPM' },
                        ]}
                    />
                );
            };

            const { activeEngMode, applyEngMode } = useEngModeState({
                showPlanning, setShowPlanning,
                showStats, setShowStats,
                showScenario, setShowScenario,
                showBoard, setShowBoard,
                trackSelectContent,
            });
            const renderEngModeControl = () => (
                <EngModeControl
                    activeMode={activeEngMode}
                    isCompletedSprintSelected={isCompletedSprintSelected}
                    isFutureSprintSelected={isFutureSprintSelected}
                    onChange={(nextMode) => {
                        applyEngMode(nextMode);
                        if (onboardingBootstrapReady && isEngOnboardingModuleSurface(nextMode)) {
                            onboarding.requestModule(nextMode);
                        }
                    }}
                    selectedSprint={selectedSprint}
                />
            );

            const renderEpmControls = (surface, { showProjectPicker = true, showStateControl = true } = {}) => (
                <EpmControls
                    selectedView={selectedView}
                    epmTab={epmTab}
                    setEpmTab={(nextTab) => {
                        trackEpmAction('tab_change', { epm_tab: analyticsToken(nextTab) });
                        setEpmTab(nextTab);
                    }}
                    surface={surface}
                    showProjectPicker={showProjectPicker}
                    showStateControl={showStateControl}
                    epmProjectsLoading={epmProjectsLoading}
                    visibleEpmProjects={visibleEpmProjects}
                    selectedEpmProject={selectedEpmProject}
                    filteredEpmProjects={filteredEpmProjects}
                    showEpmProjectDropdown={showEpmProjectDropdown}
                    activeControlSurface={activeControlSurface}
                    applyExclusiveDropdownState={applyExclusiveDropdownState}
                    epmProjectDropdownRefs={epmProjectDropdownRefs}
                    epmProjectSearch={epmProjectSearch}
                    setEpmProjectSearch={setEpmProjectSearch}
                    epmProjectSort={epmProjectSort}
                    setEpmProjectSort={(nextSort) => {
                        trackSortChanged('projects', nextSort);
                        setEpmProjectSort(nextSort);
                    }}
                    showEpmSortDropdown={showEpmSortDropdown}
                    setShowEpmSortDropdown={setShowEpmSortDropdown}
                    epmSortDropdownRefs={epmSortDropdownRefs}
                    setEpmSelectedProjectId={(projectId) => {
                        trackFilterChanged('project', { feature_name: 'epm', project_scope: projectId ? 'single' : 'all', source_surface: 'epm' });
                        setEpmSelectedProjectId(projectId);
                    }}
                    setShowEpmProjectDropdown={setShowEpmProjectDropdown}
                    savedEpmSubGoalKeys={savedEpmSubGoalKeys}
                    epmSubGoalOptions={epmSubGoals}
                    selectedEpmSubGoalKeys={epmSelectedSubGoalKeys}
                    setEpmSelectedSubGoalKeys={(nextKeys) => {
                        const count = Array.isArray(nextKeys) ? nextKeys.length : 0;
                        trackFilterChanged('subgoal', { feature_name: 'epm', subgoal_scope: count > 1 ? 'multiple' : (count === 1 ? 'single' : 'all'), selection_count_bucket: bucketCount(count), source_surface: 'epm' });
                        setEpmSelectedSubGoalKeys(nextKeys);
                    }}
                    showEpmSubGoalDropdown={showEpmSubGoalFilterDropdown}
                    setShowEpmSubGoalDropdown={setShowEpmSubGoalFilterDropdown}
                    epmSubGoalFilterDropdownRefs={epmSubGoalFilterDropdownRefs}
                    renderEpmProjectCollapseAllButton={renderEpmProjectCollapseAllButton}
                />
            );

            const renderEpmProjectCollapseAllButton = (_surface) => showEpmProjectCollapseAllButton ? (
                <EpmProjectCollapseAllButton label={epmProjectCollapseAllLabel} onClick={toggleAllVisibleEpmProjectsCollapsed} pressed={allVisibleEpmProjectsCollapsed} />
            ) : null;

            const renderSprintControl = (surface) => {
                const boardScopeControl = selectedView === 'eng' && showBoard;
                const canOpen = engSprintSelectorState.ordinarySelectable;
                const displayedSprint = boardScopeControl && boardStrictScope
                    ? (boardStrictScope === 'component' ? 'Component' : 'All work')
                    : (sprintName || (!selectedSprint && sprintsLoading && engWorkspaceConfigured ? 'Loading…' : 'Sprint'));
                const options = getSprintSelectorOptions(boardScopeControl);
                const activeIndex = options.length
                    ? Math.min(Math.max(sprintActiveOptionIndex, 0), options.length - 1)
                    : -1;
                const listboxId = `sprint-${surface}-listbox`;
                const isActiveOpen = showSprintDropdown && surface === activeControlSurface;
                const handleFilterKeyDown = (event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        closeSprintSelector({ restoreFocus: true });
                        return;
                    }
                    if (event.key === 'Tab') {
                        window.setTimeout(() => {
                            setShowSprintDropdown(false);
                            setSprintActiveOptionIndex(0);
                            sprintSelectorOriginRef.current = null;
                        }, 0);
                        return;
                    }
                    if (!options.length) return;
                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setSprintActiveOptionIndex(Math.min(activeIndex + 1, options.length - 1));
                        return;
                    }
                    if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        setSprintActiveOptionIndex(Math.max(activeIndex - 1, 0));
                        return;
                    }
                    if (event.key === 'Home') {
                        event.preventDefault();
                        setSprintActiveOptionIndex(0);
                        return;
                    }
                    if (event.key === 'End') {
                        event.preventDefault();
                        setSprintActiveOptionIndex(options.length - 1);
                        return;
                    }
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commitSprintSelectorOption(options[activeIndex], boardScopeControl);
                    }
                };
                return (<ControlField label="Sprint">
                    <div className={`sprint-dropdown sprint-selector-control${selectedView === 'eng' ? ' header-filter-dropdown header-filter-dropdown--sprint' : ''}`} ref={(node) => { sprintDropdownRefs.current[surface] = node; }}>
                        {isActiveOpen ? (
                            <div
                                className="sprint-dropdown-toggle open"
                                data-onboarding-target="sprint"
                                data-onboarding-surface={surface}
                            >
                                <input
                                    type="text"
                                    className="dropdown-toggle-filter-input"
                                    value={sprintSearch}
                                    onChange={(event) => {
                                        setSprintSearch(event.target.value);
                                        setSprintActiveOptionIndex(0);
                                    }}
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={handleFilterKeyDown}
                                    placeholder={displayedSprint}
                                    aria-label="Filter sprints"
                                    role="combobox"
                                    aria-autocomplete="list"
                                    aria-expanded="true"
                                    aria-controls={listboxId}
                                    aria-activedescendant={activeIndex >= 0
                                        ? sprintOptionDomId(surface, options[activeIndex])
                                        : undefined}
                                    autoFocus
                                />
                                <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                    <path d="M6 9L1 4h10z"/>
                                </svg>
                            </div>
                        ) : (
                            <button
                                ref={(node) => { sprintTriggerRefs.current[surface] = node; }}
                                type="button"
                                className="sprint-dropdown-toggle"
                                aria-label="Select sprint"
                                aria-haspopup="listbox"
                                aria-expanded="false"
                                aria-controls={listboxId}
                                aria-disabled={!canOpen}
                                disabled={!canOpen}
                                tabIndex={canOpen ? 0 : -1}
                                onClick={() => {
                                    if (!canOpen) return;
                                    openSprintSelector(surface, options);
                                }}
                                data-onboarding-target="sprint"
                                data-onboarding-surface={surface}
                            >
                                <span>{displayedSprint}</span>
                                <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                    <path d="M6 9L1 4h10z"/>
                                </svg>
                            </button>
                        )}
                        {isActiveOpen && (
                            <div className="sprint-dropdown-panel">
                                <div className="sprint-dropdown-list" id={listboxId} role="listbox" aria-label="Sprint options">
                                    {sprintsLoading && options.length === 0 ? (
                                        <div className="dropdown-filter-empty" role="status" aria-label="Sprint options status">Loading sprints...</div>
                                    ) : availableSprints.length === 0 && options.length === 0 ? (
                                        <div className="dropdown-filter-empty" role="status" aria-label="Sprint options status">No sprints available</div>
                                    ) : options.length === 0 ? (
                                        <div className="dropdown-filter-empty" role="status" aria-label="Sprint options status">No matching sprints</div>
                                    ) : (
                                        options.map((option, optionIndex) => {
                                            const selected = option.kind === 'scope'
                                                ? boardStrictScope === option.scope
                                                : !boardStrictScope && String(option.sprint.id) === String(selectedSprint);
                                            const state = option.kind === 'sprint'
                                                ? (option.sprint.state || '').toLowerCase()
                                                : '';
                                            const marker = state === 'closed' ? '[C]' : state === 'active' ? '[A]' : '[F]';
                                            const readinessText = option.kind === 'scope'
                                                ? (option.readiness === 'ready' ? 'Ready'
                                                    : ['loading', 'catalog_pending'].includes(option.readiness)
                                                        ? 'Loading configuration'
                                                        : 'Setup needed')
                                                : '';
                                            const descriptionId = option.kind === 'scope'
                                                ? `${sprintOptionDomId(surface, option)}-readiness`
                                                : undefined;
                                            return (
                                                <button
                                                    key={option.kind === 'scope' ? option.scope : option.sprint.id}
                                                    id={sprintOptionDomId(surface, option)}
                                                    type="button"
                                                    role="option"
                                                    tabIndex={-1}
                                                    aria-label={option.label}
                                                    aria-selected={selected}
                                                    aria-describedby={descriptionId}
                                                    className={`sprint-dropdown-option${selected ? ' selected' : ''}${optionIndex === activeIndex ? ' is-active' : ''}`}
                                                    data-sprint-id={option.kind === 'sprint' ? option.sprint.id : undefined}
                                                    onMouseMove={() => setSprintActiveOptionIndex(optionIndex)}
                                                    onClick={() => commitSprintSelectorOption(option, boardScopeControl)}
                                                >
                                                    <span>{option.kind === 'sprint' ? `${marker} ${option.label}` : option.label}</span>
                                                    {option.kind === 'scope' && (
                                                        <span id={descriptionId} className="sprint-option-readiness">{readinessText}</span>
                                                    )}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </ControlField>); };

            const renderGroupControl = (surface) => {
                if (!showGroupControl) return null;
                return (
                    <div className="group-control">
                        <ControlField label="Group">
                            <div className="group-dropdown header-filter-dropdown header-filter-dropdown--group" ref={(node) => { groupDropdownRefs.current[surface] = node; }}>
                                <div
                                    className={`group-dropdown-toggle ${showGroupDropdown ? 'open' : ''}`}
                                    role={showGroupDropdown ? undefined : 'button'}
                                    aria-label={showGroupDropdown ? undefined : 'Select group'}
                                    tabIndex={showGroupDropdown ? undefined : (groupsLoading ? -1 : 0)}
                                    onClick={() => {
                                        if (showGroupDropdown) return;
                                        if (groupsLoading) return;
                                        applyExclusiveDropdownState('group', showGroupDropdown);
                                    }}
                                    onKeyDown={(event) => {
                                        if (showGroupDropdown) return;
                                        if (groupsLoading) return;
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            applyExclusiveDropdownState('group', showGroupDropdown);
                                        }
                                    }}
                                    aria-disabled={groupsLoading}
                                    data-onboarding-target="group"
                                    data-onboarding-surface={surface}
                                >
                                    {showGroupDropdown ? (
                                        <input
                                            type="text"
                                            className="dropdown-toggle-filter-input"
                                            value={groupDropdownQuery}
                                            onChange={(event) => setGroupDropdownQuery(event.target.value)}
                                            onClick={(event) => event.stopPropagation()}
                                            onKeyDown={(event) => {
                                                event.stopPropagation();
                                                if (event.key === 'Escape') {
                                                    event.preventDefault();
                                                    setShowGroupDropdown(false);
                                                }
                                            }}
                                            placeholder={activeGroup?.name || 'Group'}
                                            aria-label="Filter groups"
                                            autoFocus={surface === activeControlSurface}
                                        />
                                    ) : (
                                        <span>{activeGroup?.name || (groupsLoading ? 'Loading...' : 'Group')}</span>
                                    )}
                                    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                        <path d="M6 9L1 4h10z"/>
                                    </svg>
                                </div>
                                {showGroupDropdown && surface === activeControlSurface && (
                                    <div className="group-dropdown-panel">
                                        {groupsLoading ? (
                                            <div className="group-dropdown-option">Loading groups...</div>
                                        ) : (visibleControlGroups || []).length === 0 ? (
                                            <div className="group-dropdown-option">No groups yet</div>
                                        ) : filteredControlGroups.length === 0 ? (
                                            <div className="dropdown-filter-empty" role="status">No matching groups</div>
                                        ) : (
                                            filteredControlGroups.map(group => (
                                                <div
                                                    key={group.id}
                                                    className="group-dropdown-option"
                                                    onClick={() => {
                                                        trackFilterChanged('group', { group_count_bucket: bucketCount(group?.teamIds?.length || 0), scope_type: currentDashboardView() });
                                                        setActiveGroupId(group.id);
                                                        setShowGroupDropdown(false);
                                                    }}
                                                >
                                                    <span>{group.name}</span>
                                                    <div className="group-option-tags">
                                                        {(groupsConfig.source === 'workspace_db'
                                                            ? groupPreferences.activeGroupId === group.id
                                                            : groupsConfig.defaultGroupId === group.id) && (
                                                            <span
                                                                className="group-option-default"
                                                                title={groupsConfig.source === 'workspace_db' ? 'My favorite group' : 'Default group'}
                                                            >★</span>
                                                        )}
                                                        <span className="group-option-meta">
                                                            {group.teamIds?.length || 0} teams
                                                        </span>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </ControlField>
                    </div>
                );
            };

            const renderTeamControl = (surface) => (
                <ControlField label="Teams">
                    <div className="team-dropdown header-filter-dropdown header-filter-dropdown--team" ref={(node) => { teamDropdownRefs.current[surface] = node; }}>
                        <div
                            className={`team-dropdown-toggle ${showTeamDropdown ? 'open' : ''} ${!isAllTeamsSelected ? 'active-filter applied-filter' : ''}`}
                            role={showTeamDropdown ? undefined : 'button'}
                            aria-label={showTeamDropdown ? undefined : 'Filter teams'}
                            tabIndex={showTeamDropdown ? undefined : (tasks.length === 0 && loading ? -1 : 0)}
                            onClick={() => {
                                if (showTeamDropdown) return;
                                if (tasks.length === 0 && loading) return;
                                applyExclusiveDropdownState('team', showTeamDropdown);
                            }}
                            onKeyDown={(event) => {
                                if (showTeamDropdown) return;
                                if (tasks.length === 0 && loading) return;
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    applyExclusiveDropdownState('team', showTeamDropdown);
                                }
                            }}
                            aria-disabled={tasks.length === 0 && loading}
                            data-onboarding-target="teams"
                            data-onboarding-surface={surface}
                        >
                            {showTeamDropdown ? (
                                <input
                                    type="text"
                                    className="dropdown-toggle-filter-input"
                                    value={teamDropdownQuery}
                                    onChange={(event) => setTeamDropdownQuery(event.target.value)}
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => {
                                        event.stopPropagation();
                                        if (event.key === 'Escape') {
                                            event.preventDefault();
                                            setShowTeamDropdown(false);
                                        }
                                    }}
                                    placeholder={selectedTeamsLabel}
                                    aria-label="Filter teams"
                                    autoFocus={surface === activeControlSurface}
                                />
                            ) : (
                                <span style={{flex: 1, display: 'grid', textAlign: 'left', minWidth: 0}}>
                                    <span className="team-dropdown-selection-label" style={{gridArea: '1/1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{selectedTeamsLabel}</span>
                                    <span className="team-dropdown-width-label" style={{gridArea: '1/1', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap'}} aria-hidden="true">{longestTeamOptionLabel}</span>
                                </span>
                            )}
                            <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                <path d="M6 9L1 4h10z"/>
                            </svg>
                        </div>
                        {showTeamDropdown && surface === activeControlSurface && (
                            <div className="team-dropdown-panel">
                                {filteredTeamOptions.length === 0 && teamDropdownQuery.trim() ? (
                                    <div className="dropdown-filter-empty" role="status">No matching teams</div>
                                ) : filteredTeamOptions.map(team => (
                                    <label key={team.id} className="team-dropdown-option">
                                        <input
                                            type="checkbox"
                                            checked={team.id === 'all' ? isAllTeamsSelected : selectedTeamSet.has(team.id)}
                                            onChange={() => toggleTeamSelection(team.id)}
                                        />
                                        <span>{team.name}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </ControlField>
            );

            const shouldRenderIssueDependencies = (selectedView === 'eng' || selectedView === 'epm') && showDependencies;
            const issueDependencyContext = {
                dependencyData,
                dependencyFocus,
                dependencyHover,
                activeDependencyFocus,
                focusRelatedSet,
                issueByKey,
                visibleTaskKeySet,
                dependencyLookupCache,
                dependencyLookupLoading,
                normalizeStatus,
                getTeamInfo,
                onHoverEnter: handleDependencyHoverEnter,
                onHoverLeave: handleDependencyHoverLeave,
            };
            const renderPlanningReviewFieldEditor = ({ row, field, value }) => {
                if (row.synthetic || !row.key) return null;
                const capacityEpicKey = row.rowKind === 'epic' ? row.key : row.epicKey;
                if (field === 'inclusion' && capacityEpicKey) return <button type="button" className={`epic-stat-toggle ${excludedEpicSet.has(normalizeEpicKey(capacityEpicKey)) ? '' : 'active'}`} disabled={!canToggleSharedGroupExcludedCapacity}
                    onClick={() => toggleSharedGroupExcludedCapacityEpic(capacityEpicKey)}>{excludedEpicSet.has(normalizeEpicKey(capacityEpicKey)) ? 'Excluded' : 'Included'}</button>;
                if (field === 'projectTrack' && row.rowKind === 'epic' && projectTrackTransitionEnabled) return <ProjectTrackTransitionMenu epicKey={row.key} currentTrack={row.projectTrack}
                    isOpen={projectTrackTransitionActiveKey === row.key} options={projectTrackOptions} optionsLoading={projectTrackOptionsLoading}
                    submitting={projectTrackSubmitting || pendingProjectTrackIssueKeys.has(row.key)} error={projectTrackError} result={projectTrackResult}
                    onOpen={openProjectTrackControl} onClose={closeProjectTrackControl} onSubmit={submitProjectTrackChange} />;
                if (!issueFieldEditsEnabled) return null;
                if (field === 'status') return <StatusTransitionMenu
                    issue={{ key: row.key, status: row.status, summary: row.summary }} fallbackIssueType={row.rowKind === 'epic' ? 'Epic' : 'Story'}
                    statusLabel={row.status} statusClassName={getIssueStatusClassName(row.status)} sourceSurface="planning" isOpen={statusTransitionActiveKey === row.key}
                    options={transitionOptions} optionsLoading={transitionOptionsLoading} submitting={statusTransitionSubmitting || pendingStatusIssueKeys.has(row.key)}
                    error={transitionError} errorCode={transitionErrorCode} result={transitionResult} actsOnSelection={false}
                    onOpen={openSingleIssueStatusControl} onPrefetch={prefetchSingleIssueStatusOptions} onClose={closeSingleIssueStatusControl} onSubmit={(targetStatus) => handleSubmitStatusTransition(targetStatus, { key: row.key }, { singleIssue: true })} />;
                if (field === 'priority') return <PriorityTransitionMenu
                    issue={{ key: row.key, priority: row.priority, summary: row.summary }} fallbackIssueType={row.rowKind === 'epic' ? 'Epic' : 'Story'}
                    priorityLabel={row.priority} currentPriorityLabel={row.priority} renderPriorityIcon={renderPriorityIcon}
                    isOpen={priorityTransitionActiveKey === row.key} options={priorityOptions} optionsLoading={priorityOptionsLoading}
                    submitting={prioritySubmitting || pendingPriorityIssueKeys.has(row.key)} error={priorityError} result={priorityResult}
                    onOpen={openPriorityControl} onClose={closePriorityControl} onSubmit={submitPriorityChange} />;
                const editorField = field === 'storyPoints' ? 'storyPoints' : field;
                if (!['summary', 'team', 'assignee', 'storyPoints'].includes(editorField) || (editorField === 'storyPoints' && row.rowKind !== 'story')) return null;
                const active = issueFieldEdits.activeEditor?.issueKey === row.key && issueFieldEdits.activeEditor?.field === editorField;
                const common = {
                    issueKey: row.key, currentValue: editorField === 'team' ? row.team : value, isOpen: active, metadata: active ? issueFieldEdits.metadata : null,
                    loading: active && issueFieldEdits.status === 'loading', submitting: active && ['queued', 'saving'].includes(issueFieldEdits.status),
                    pending: issueFieldEdits.pendingIssueKeys.has(row.key), error: active ? issueFieldEdits.errorMessage : '',
                    recoveryMode: active && issueFieldEdits.status === 'conflict' ? 'reload' : active && issueFieldEdits.status === 'unknown' ? 'check_jira' : '',
                    onOpen: () => issueFieldEdits.openEditor({ issueKey: row.key, field: editorField, issueKind: row.rowKind, sourceSurface: 'planning' }),
                    onClose: issueFieldEdits.closeEditor, onReload: issueFieldEdits.reload, onCheckJira: issueFieldEdits.checkJira,
                    onSelect: async next => { const result = await issueFieldEdits.submit(next); if (result) issueFieldEdits.closeEditor('saved'); },
                };
                if (editorField === 'summary') return <IssueSummaryEditor {...common} />;
                if (editorField === 'team') return <IssueTeamEditor {...common} />;
                if (editorField === 'storyPoints') return <StoryPointsEditor {...common} currentValue={row.issue?.fields?.customfield_10004 ?? null} onSubmit={issueFieldEdits.submit} />;
                return <IssuePersonEditor {...common} field="assignee" fieldLabel="Assignee" currentValue={row.issue?.fields?.assignee || row.issue?.assignee || null}
                    suggestions={active ? issueFieldEdits.suggestions : []} query={active ? issueFieldEdits.searchQuery : ''} searching={active && issueFieldEdits.searching}
                    onSearch={issueFieldEdits.search} jiraUrl={jiraUrl} />;
            };

            const issueCardContext = {
                jiraUrl,
                renderPriorityIcon,
                allowSelection: showPlanning,
                selectedTasks,
                onToggleSelection: toggleTaskSelection,
                onRemove: removeTask,
                shouldRenderIssueDependencies,
                dependencyContext: issueDependencyContext,
                onDependencyFocusClick: handleDependencyFocusClick,
            };

            connectionRecoverySnapshotRef.current = () => {
                const dirtyScenario = scenarioHasUnsavedChanges;
                return buildConnectionRecoverySnapshot({
                    activeGroupId, dirtySettings: showGroupManage && isGroupDraftDirty,
                    principal: connectionRecoveryPrincipalRef.current,
                    selectedSprint, selectedView,
                    scenario: dirtyScenario ? {
                        scopeKey: scenarioDraftMeta.scopeKey,
                        groupId: String(scenarioDraftMeta.scopePayload?.groupId || ''),
                        sprintId: String(scenarioDraftMeta.scopePayload?.sprintId || ''),
                        activeDraftId: scenarioDraftMeta.activeDraft?.draftId || null,
                        baseDraftRevision: Number(scenarioDraftMeta.baseDraftRevision || 0),
                        savedOverrides: normalizeScenarioDraftOverrides(scenarioDraftMeta.savedOverrides),
                        localOverrides: normalizeScenarioDraftOverrides(scenarioOverrides),
                        editMode: scenarioEditMode,
                        scrollTop: Math.max(0, scenarioTimelineRef.current?.scrollTop || 0),
                        scrollLeft: Math.max(0, scenarioTimelineRef.current?.scrollLeft || 0),
                    } : null,
                    viewMode: showPlanning ? 'planning' : showStats ? 'statistics' : showScenario ? 'scenario' : showBoard ? 'board' : 'catch-up',
                });
            };

            const renderEpicBlock = (epicGroup) => {
                        const epicInfo = epicGroup.epic;
                        const epicTitle = epicInfo?.summary || epicGroup.parentSummary ||
                            (epicGroup.key === 'NO_EPIC' ? 'No Epic Linked' : epicGroup.key);
                        const epicTotalSp = epicGroup.storyPoints || 0;
                        const epicStatus = typeof epicInfo?.status === 'string'
                            ? epicInfo.status
                            : epicInfo?.status?.name || '';
                        const epicStatusClassName = epicStatus
                            ? getIssueStatusClassName(epicStatus, 'epic-status-pill')
                            : '';
                        const effectivePriority = getEpicEffectivePriority(epicGroup);
                        // The header icon shows the derived (most-urgent child) priority, but the
                        // priority menu edits the Epic's OWN priority field; normalize it to a name
                        // the same way epicStatus is handled above.
                        const epicOwnPriority = typeof epicInfo?.priority === 'string'
                            ? epicInfo.priority
                            : epicInfo?.priority?.name || '';
                        const projectTrackValue = epicInfo?.projectTrack || '';
                        const projectTrackEmoji = getProjectTrackEmoji(projectTrackValue);
                        const epicInteractionActive = statusTransitionActiveKey === epicGroup.key
                            || priorityTransitionActiveKey === epicGroup.key
                            || projectTrackTransitionActiveKey === epicGroup.key
                            || issueFieldEdits.activeEditor?.issueKey === epicGroup.key;
                        const renderEpicPersonEditor = (field, label, value) => {
                            const editableEpic = issueFieldEditsEnabled && epicGroup.key !== 'NO_EPIC' && Boolean(epicInfo), active = editableEpic && issueFieldEdits.activeEditor?.issueKey === epicGroup.key && issueFieldEdits.activeEditor.field === field;
                            const displayName = value?.displayName || (field === 'deliveryOwner' ? 'Not set' : 'Unassigned');
                            if (!editableEpic) {
                                return (
                                    <EpicHeaderValueReadout value={displayName} suppressed={epicInteractionActive}>
                                        {({ discoveryProps }) => (
                                            <span {...discoveryProps} className="epic-full-value-trigger epic-assignee-value">
                                                {displayName}
                                            </span>
                                        )}
                                    </EpicHeaderValueReadout>
                                );
                            }
                            return (
                                <EpicHeaderValueReadout
                                    value={displayName}
                                    suppressed={epicInteractionActive}
                                    measureSelector="[data-issue-person-editor-trigger]"
                                    nativeSelector="[data-issue-person-editor-trigger]"
                                >
                                    {({ triggerRef, pointerProps, focusProps }) => (
                                        <span ref={triggerRef} {...pointerProps} {...focusProps} className="epic-full-value-trigger epic-assignee-value">
                                            <IssuePersonEditor issueKey={epicGroup.key} field={field} fieldLabel={label} currentValue={value} isOpen={active} metadata={active ? issueFieldEdits.metadata : null}
                                                suggestions={active ? issueFieldEdits.suggestions : []} query={active ? issueFieldEdits.searchQuery : ''} loading={active && issueFieldEdits.status === 'loading'} searching={active && issueFieldEdits.searching}
                                                submitting={active && ['queued', 'saving'].includes(issueFieldEdits.status)} pending={issueFieldEdits.pendingIssueKeys.has(epicGroup.key)} error={active ? issueFieldEdits.errorMessage : ''} statusMessage={active && issueFieldEdits.status === 'confirmed' ? 'Saved in Jira.' : active && issueFieldEdits.outcome?.status === 'observed' ? 'Current value loaded from Jira.' : ''} recoveryMode={active && issueFieldEdits.status === 'conflict' ? 'reload' : active && issueFieldEdits.status === 'unknown' ? 'check_jira' : ''} configurationChanged={active && issueFieldEdits.outcome?.configurationChanged === true} jiraUrl={jiraUrl}
                                                onOpen={() => issueFieldEdits.openEditor({ issueKey: epicGroup.key, field, issueKind: 'epic', sourceSurface: statusTransitionSourceSurface })} onClose={issueFieldEdits.closeEditor} onSearch={issueFieldEdits.search} onSelect={issueFieldEdits.submit} onReload={issueFieldEdits.reload} onCheckJira={issueFieldEdits.checkJira} />
                                        </span>
                                    )}
                                </EpicHeaderValueReadout>
                            );
                        };
                        return (
                            <div
                                key={epicGroup.key}
                                className={`epic-block ${epicGroup.hasNoChildStories ? 'epic-block-no-child-stories' : ''} ${excludedEpicSet.has(normalizeEpicKey(epicGroup.key)) ? 'epic-excluded' : ''} ${stickyEpicFocusKey === epicGroup.key ? 'epic-block-sticky-focus' : ''}`}
                                data-onboarding-target="hierarchy-epic"
                                data-epic-key={epicGroup.key}
                                ref={(node) => {
                                    if (!node) {
                                        epicRefMap.current.delete(epicGroup.key);
                                        return;
                                    }
                                    epicRefMap.current.set(epicGroup.key, node);
                                }}
                            >
	                                <div className="epic-header">
                                        <div className="epic-title">
	                                        <div className="epic-title-row">
                                            <span className="epic-icon" aria-hidden="true" title="EPIC">
                                                <svg viewBox="0 0 16 16" fill="none">
                                                    <path
                                                        clipRule="evenodd"
                                                        d="m10.271.050656c.2887.111871.479.38969.479.699344v4.63515l3.1471.62941c.2652.05303.4812.24469.5655.50161s.0238.53933-.1584.73914l-7.74997 8.49999c-.20863.2288-.53644.3059-.82517.194-.28874-.1118-.47905-.3896-.47905-.6993v-4.6351l-3.14708-.62947c-.26515-.05303-.48123-.24468-.56553-.5016-.08431-.25692-.02379-.53933.1584-.73915l7.75-8.499996c.20863-.2288201.53643-.305899.8252-.194028zm-6.57276 8.724134 3.05177.61036v3.92915l5.55179-6.08909-3.05179-.61036v-3.9291z"
                                                        fill="#bf63f3"
                                                        fillRule="evenodd"
                                                    />
                                                </svg>
                                            </span>
                                            {effectivePriority.name && (
                                                (priorityTransitionEnabled && epicGroup.key !== 'NO_EPIC') ? (
                                                    <PriorityTransitionMenu
                                                        issue={{ key: epicGroup.key, priority: epicOwnPriority, summary: epicTitle }}
                                                        fallbackIssueType="Epic"
                                                        priorityLabel={effectivePriority.name}
                                                        currentPriorityLabel={epicOwnPriority}
                                                        renderPriorityIcon={renderPriorityIcon}
                                                        isOpen={priorityTransitionActiveKey === epicGroup.key}
                                                        options={priorityOptions}
                                                        optionsLoading={priorityOptionsLoading}
                                                        submitting={prioritySubmitting || pendingPriorityIssueKeys.has(epicGroup.key)}
                                                        error={priorityError}
                                                        result={priorityResult}
                                                        onOpen={openPriorityControl}
                                                        onClose={closePriorityControl}
                                                        onSubmit={submitPriorityChange}
                                                        previewOnly={onboardingPreviewSession}
                                                        onPreviewLifecycleChange={handleOnboardingPreviewLifecycleChange}
                                                    />
                                                ) : (
                                                    renderPriorityIcon(effectivePriority.name, epicGroup.key)
                                                )
                                            )}
                                            {epicGroup.key !== 'NO_EPIC' && (
                                                projectTrackTransitionEnabled ? (
                                                    <ProjectTrackTransitionMenu
                                                        epicKey={epicGroup.key}
                                                        currentTrack={projectTrackValue}
                                                        isOpen={projectTrackTransitionActiveKey === epicGroup.key}
                                                        options={projectTrackOptions}
                                                        optionsLoading={projectTrackOptionsLoading}
                                                        submitting={projectTrackSubmitting || pendingProjectTrackIssueKeys.has(epicGroup.key)}
                                                        error={projectTrackError}
                                                        result={projectTrackResult}
                                                        onOpen={openProjectTrackControl}
                                                        onClose={closeProjectTrackControl}
                                                        onSubmit={submitProjectTrackChange}
                                                        previewOnly={onboardingPreviewSession}
                                                        onPreviewLifecycleChange={handleOnboardingPreviewLifecycleChange}
                                                    />
                                                ) : (
                                                    <span
                                                        className="epic-track-indicator"
                                                        title={`Project Track: ${getProjectTrackLabel(projectTrackValue)}`}
                                                        aria-label={`Project Track: ${getProjectTrackLabel(projectTrackValue)}`}
                                                    >
                                                        {projectTrackEmoji}
                                                    </span>
                                                )
                                            )}
                                            {epicGroup.key !== 'NO_EPIC' ? (
                                                <EpicHeaderValueReadout
                                                    value={epicTitle}
                                                    suppressed={epicInteractionActive}
                                                    measureSelector=".epic-name"
                                                >
                                                    {({ triggerRef, describedBy, pointerProps, focusProps }) => (
                                                        <a
                                                            ref={triggerRef}
                                                            className="epic-link epic-full-value-trigger"
                                                            href={jiraUrl ? `${jiraUrl}/browse/${epicGroup.key}` : '#'}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            aria-label={epicTitle}
                                                            aria-describedby={describedBy}
                                                            {...pointerProps}
                                                            {...focusProps}
                                                        >
                                                            <span className="epic-name">{epicTitle}</span>
                                                            <span className="epic-key">{epicGroup.key}</span>
                                                        </a>
                                                    )}
                                                </EpicHeaderValueReadout>
                                            ) : (
                                                <>
                                                    <EpicHeaderValueReadout value={epicTitle} suppressed={epicInteractionActive}>
                                                        {({ discoveryProps }) => (
                                                            <span {...discoveryProps} className="epic-name epic-full-value-trigger">{epicTitle}</span>
                                                        )}
                                                    </EpicHeaderValueReadout>
                                                    <span className="epic-key">Unassigned</span>
                                                </>
                                            )}
                                            {(showStats || showPlanning) && (
                                                <button
                                                    className={`epic-stat-toggle ${excludedEpicSet.has(normalizeEpicKey(epicGroup.key)) ? '' : 'active'}`}
                                                    onClick={() => toggleSharedGroupExcludedCapacityEpic(epicGroup.key)}
                                                    disabled={!canToggleSharedGroupExcludedCapacity}
                                                    title={!canEditSharedConfiguration
                                                        ? 'You do not have permission to edit shared group capacity settings'
                                                        : (showGroupManage && isGroupDraftDirty)
                                                            ? 'Save or discard open Department settings changes before changing excluded capacity'
                                                            : 'Include/exclude this epic in shared group capacity and reporting'}
                                                >
                                                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                                                        <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                    </svg>
                                                    {excludedEpicSet.has(normalizeEpicKey(epicGroup.key)) ? 'Excluded' : 'Included'}
                                                </button>
                                            )}
                                        </div>
	                                    </div>
	                                    <div className="epic-meta">
                                            {epicStatus && (
                                                <EpicHeaderValueReadout
                                                    value={epicStatus}
                                                    suppressed={epicInteractionActive}
                                                    measureSelector=".status-pill"
                                                    nativeSelector={statusTransitionEnabled && epicGroup.key !== 'NO_EPIC' ? '.status-pill' : ''}
                                                >
                                                    {statusTransitionEnabled && epicGroup.key !== 'NO_EPIC' ? (
                                                        ({ triggerRef, pointerProps, focusProps }) => (
                                                            <span ref={triggerRef} {...pointerProps} {...focusProps} className="epic-full-value-trigger epic-status-readout-target">
                                                                <StatusTransitionMenu
                                                                    issue={{ key: epicGroup.key, status: epicStatus, summary: epicTitle }}
                                                                    fallbackIssueType="Epic"
                                                                    statusLabel={epicStatus}
                                                                    statusClassName={epicStatusClassName}
                                                                    sourceSurface={statusTransitionSourceSurface}
                                                                    isOpen={statusTransitionActiveKey === epicGroup.key}
                                                                    options={transitionOptions}
                                                                    optionsLoading={transitionOptionsLoading}
                                                                    submitting={statusTransitionSubmitting || pendingStatusIssueKeys.has(epicGroup.key)}
                                                                    error={transitionError}
                                                                    errorCode={transitionErrorCode}
                                                                    result={transitionResult}
                                                                    onOpen={openSingleIssueStatusControl} onPrefetch={prefetchSingleIssueStatusOptions}
                                                                    onClose={closeSingleIssueStatusControl}
                                                                    onSubmit={(targetStatus) => handleSubmitStatusTransition(targetStatus, { key: epicGroup.key }, { singleIssue: true })}
                                                                    previewOnly={onboardingPreviewSession}
                                                                    onPreviewLifecycleChange={handleOnboardingPreviewLifecycleChange}
                                                                />
                                                            </span>
                                                        )
                                                    ) : (
                                                        ({ triggerRef, truncated, describedBy, pointerProps, focusProps }) => (
                                                            <span
                                                                ref={triggerRef}
                                                                {...pointerProps}
                                                                {...focusProps}
                                                                className="epic-full-value-trigger epic-status-readout-target"
                                                                tabIndex={truncated ? 0 : undefined}
                                                                aria-label={epicStatus}
                                                                aria-describedby={describedBy}
                                                            >
                                                                <StatusPill
                                                                    className={`${epicStatusClassName} epic-status-value`}
                                                                    label={epicStatus}
                                                                    status={epicStatus}
                                                                />
                                                            </span>
                                                        )
                                                    )}
                                                </EpicHeaderValueReadout>
                                            )}
	                                        <span className="epic-story-points">SP: {epicTotalSp.toFixed(1)}</span>
	                                        {(epicInfo?.assignee?.displayName || (issueFieldEditsEnabled && epicGroup.key !== 'NO_EPIC' && epicInfo)) && (
	                                            <span className="task-assignee epic-assignee">
	                                                <span className="task-assignee-icon" aria-hidden="true">
	                                                    <svg viewBox="0 0 24 24" fill="none">
	                                                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" stroke="currentColor" strokeWidth="2" />
	                                                        <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
	                                                    </svg>
	                                                </span>
	                                                {renderEpicPersonEditor('assignee', 'Assignee', epicInfo?.assignee)}
	                                            </span>
	                                        )}
	                                    </div>
                                    {isEpicRefreshMode && epicGroup.key !== 'NO_EPIC' && (
                                        <EpicRefreshButton epicKey={epicGroup.key} epicName={epicTitle} state={epicRefresh.epicStates[epicGroup.key] || 'idle'} onRefresh={epicRefresh.refreshEpic} />
                                    )}
	                                </div>
                                {(epicGroup.rows || epicGroup.tasks.map(task => ({ kind: 'story', id: task.key, task }))).map(row => {
                                    if (row.kind === 'story_requirement') {
                                        return (
                                            <StoryRequirementCard
                                                key={row.id}
                                                requirement={row}
                                                jiraUrl={jiraUrl}
                                                sourceSurface={showPlanning ? 'planning' : 'catch_up'}
                                            />
                                        );
                                    }
                                    const task = row.task;
                                    const teamInfo = getTeamInfo(task);
                                    const teamLabel = getIssueTeamLabel(teamInfo);
                                    const statusClassName = getIssueStatusClassName(task.fields.status?.name);
                                    return (
                                        <IssueCard
                                            key={task.key}
                                            task={task}
                                            jiraUrl={jiraUrl}
                                            teamInfo={teamInfo}
                                            teamLabel={teamLabel}
                                            statusClassName={statusClassName}
                                            renderPriorityIcon={renderPriorityIcon}
                                            showPlanning={showPlanning}
                                            isSelected={!!selectedTasks[task.key]}
                                            onToggleSelection={toggleTaskSelection}
                                            onRemove={removeTask}
                                            isLeaving={epicRefresh.leavingKeys.has(task.key)}
                                            shouldRenderIssueDependencies={shouldRenderIssueDependencies}
                                            dependencyContext={issueDependencyContext}
                                            subtaskState={storySubtasksByKey[task.key] || null}
                                            onToggleSubtasks={toggleStorySubtasks}
                                            onRetrySubtasks={retryStorySubtasks}
                                            statusTransitionEnabled={statusTransitionEnabled}
                                            statusTransitionSourceSurface={statusTransitionSourceSurface}
                                            statusTransitionActiveKey={statusTransitionActiveKey}
                                            statusTransitionOptions={transitionOptions}
                                            statusTransitionOptionsLoading={transitionOptionsLoading}
                                            statusTransitionSubmitting={statusTransitionSubmitting}
                                            statusTransitionError={transitionError}
                                            statusTransitionErrorCode={transitionErrorCode}
                                            statusTransitionResult={transitionResult}
                                            statusTransitionTargetsCount={statusTransitionTargetsCount}
                                            statusTransitionPendingIssueKeys={pendingStatusIssueKeys}
                                            onOpenStatusTransition={openSingleIssueStatusControl} onPrefetchStatusTransition={prefetchSingleIssueStatusOptions}
                                            onCloseStatusTransition={closeSingleIssueStatusControl}
                                            onSubmitStatusTransition={handleSubmitStatusTransition}
                                            priorityTransitionEnabled={priorityTransitionEnabled}
                                            priorityTransitionActiveKey={priorityTransitionActiveKey}
                                            priorityTransitionOptions={priorityOptions}
                                            priorityTransitionOptionsLoading={priorityOptionsLoading}
                                            priorityTransitionSubmitting={prioritySubmitting}
                                            priorityTransitionError={priorityError}
                                            priorityTransitionResult={priorityResult}
                                            priorityTransitionPendingIssueKeys={pendingPriorityIssueKeys}
                                            onOpenPriorityTransition={openPriorityControl}
                                            onClosePriorityTransition={closePriorityControl}
                                            onSubmitPriorityTransition={submitPriorityChange}
                                            onboardingPreviewSession={onboardingPreviewSession}
                                            onPreviewLifecycleChange={handleOnboardingPreviewLifecycleChange}
                                            issueFieldEdits={issueFieldEditsEnabled ? issueFieldEdits : null}
                                        />
                                    );
                                })}
                            </div>
                        );
            };

            const settingsHeaderAction = onboardingAvailable
                && groupPreferences.onboardingRequired === false
                && !firstRunConfigurationActive ? (
                    <div className="settings-onboarding-replay">
                        <button
                            type="button"
                            className="secondary compact"
                            onClick={() => { void onboarding.replay(); }}
                            disabled={onboardingReplayDisabled}
                            aria-describedby={onboardingReplayDisabled ? 'settings-onboarding-replay-disabled' : undefined}
                        >
                            {onboarding.pending ? 'Starting onboarding...' : 'Run onboarding again'}
                        </button>
                        {onboardingReplayDisabled && (
                            <span id="settings-onboarding-replay-disabled" className="group-modal-meta">
                                Save or discard changes before replaying onboarding.
                            </span>
                        )}
                        {!onboarding.run && onboarding.error && <span className="group-modal-meta" role="alert">{onboarding.error}</span>}
                    </div>
                ) : null;

            const longAbsenceRefreshRef = useRef(null);
            const retryBoardScopeConfiguration = () => {
                if (boardScopeRetryRef.current) return boardScopeRetryRef.current;
                const retry = Promise.all([loadConfig(), loadGroupsConfig()]).finally(() => {
                    if (boardScopeRetryRef.current === retry) boardScopeRetryRef.current = null;
                });
                boardScopeRetryRef.current = retry;
                return retry;
            };
            const refreshActiveViewFromJira = () => {
                if (selectedView === 'epm') {
                    void refreshEpmView();
                    return;
                }
                if (strictBoardActive) { void strictBoardData.refresh(); return; }
                if (boardScopeRequested) {
                    if (selectedScopeReadiness !== 'unsupported') void retryBoardScopeConfiguration();
                    return;
                }
                if (!sprintCatalogReady) {
                    void loadSprints(true, { queueIfBusy: true });
                    return;
                }
                if (activeGroupId) {
                    groupStateRef.current.delete(activeGroupId);
                }
                if (selectedView === 'eng' && showPlanning) {
                    setCapacityRefreshNonce(previous => previous + 1);
                    // A review that is loading or saving is already current (the old Refresh review button was disabled then too).
                    if (planningLayout === 'table' && !planningReview.loading && !planningReview.saving) void planningReview.refresh();
                }
                burnoutCacheRef.current = {};
                cohortCacheRef.current = {};
                excludedCapacityCacheRef.current = {};
                loadSprints(true, { queueIfBusy: true });
                if (isStatsSourceOnlyStatsView) {
                    excludedCapacityForceRefreshRef.current = true;
                    setExcludedCapacityData(null);
                    setExcludedCapacityError('');
                    setExcludedCapacityRefreshNonce(prev => prev + 1);
                    return;
                }
                rearmCatchUpAlerts();
                loadMeasuredGroupTasks({ forceRefresh: true });
            };
            const manualRefreshDisabled = connectionRecoveryBlocksRefresh || (selectedView === 'eng' ? !engWorkspaceConfigured || (strictBoardActive ? strictBoardData.status === 'loading' || strictBoardData.scope?.type === 'uninitialized'
                : boardScopeRequested ? ['loading', 'catalog_pending', 'unsupported'].includes(selectedScopeReadiness)
                : loading || groupsLoading || groupPreferences.onboardingRequired)
                : (epmProjectsLoading || epmRollupLoading));
            longAbsenceRefreshRef.current = manualRefreshDisabled ? null : refreshActiveViewFromJira;
            useEffect(() => {
                const handleLongAbsenceReturn = () => {
                    longAbsenceRefreshRef.current?.();
                };
                window.addEventListener(AUTH_LONG_ABSENCE_EVENT, handleLongAbsenceReturn);
                return () => window.removeEventListener(AUTH_LONG_ABSENCE_EVENT, handleLongAbsenceReturn);
            }, []);
            const epicInteractionActiveFor = (epicKey) => statusTransitionActiveKey === epicKey || priorityTransitionActiveKey === epicKey
                || projectTrackTransitionActiveKey === epicKey || issueFieldEdits.activeEditor?.issueKey === epicKey;
            // The merge's flushSync commit runs the dependencies effect before afterApply, so the one-shot skip is armed here, from the
            // signature the merge is about to produce; a mismatch only means the normal department refetch runs.
            // The skip is bound to the department load epoch the held lists came from, so a department load that lands first rejects it.
            const loadEpicRefreshWithDependencySkip = async (args) => {
                const armEpoch = loadEpochRef.current;
                const lanes = await loadEpicRefresh(args);
                const nextKeys = new Set();
                [['product', loadedProductTasks], ['tech', loadedTechTasks]].forEach(([lane, held]) => {
                    const result = lanes?.[lane];
                    const merged = result?.status === 'ok' ? mergeEpicStories({
                        held, fetched: result.items || [], epicKey: args.epicKey, capped: result.meta?.capped === true,
                        detailsMissing: (result.meta?.epicKeysMissing || []).includes(args.epicKey),
                    }).items : held;
                    merged.forEach(task => nextKeys.add(task.key));
                });
                markDependencySignature([...nextKeys].filter(Boolean).sort().join('|'), armEpoch);
                return lanes;
            };
            const epicRefresh = useEpicRefresh({
                loadEpicRefresh: loadEpicRefreshWithDependencySkip,
                getState: () => ({ productTasks, techTasks, loadedProductTasks, loadedTechTasks, epicDetails, readyToCloseProductTasks, readyToCloseTechTasks, missingPlanningInfoTasks,
                    productEpicsInScope, techEpicsInScope, readyToCloseProductEpicsInScope, readyToCloseTechEpicsInScope }),
                setters: { setProductTasks, setTechTasks, setLoadedProductTasks, setLoadedTechTasks, setEpicDetails, setReadyToCloseProductTasks, setReadyToCloseTechTasks,
                    setProductEpicsInScope, setTechEpicsInScope, setReadyToCloseProductEpicsInScope, setReadyToCloseTechEpicsInScope, setMissingPlanningInfoTasks, setMissingInfoEpics, setBacklogProductEpics, setBacklogTechEpics },
                readGuards: (epicKey) => ({
                    blocked: loading || productTasksLoading || techTasksLoading || manualRefreshDisabled || !tasksFetched
                        || String(lastLoadedSprintRef.current ?? '') !== String(selectedSprint ?? '')
                        || alertCohortRef.current !== null || boardScopeRequested || !isEpicRefreshMode || epicInteractionActiveFor(epicKey),
                    reason: '', epoch: loadEpochRef.current, version: groupLoadVersionRef.current, scopeKey: `${activeGroupId}|${selectedSprint}`,
                }),
                getProtectedKeys: () => new Set([...pendingStatusIssueKeys, ...pendingPriorityIssueKeys, ...pendingProjectTrackIssueKeys, ...issueFieldEdits.pendingIssueKeys,
                    statusTransitionActiveKey, priorityTransitionActiveKey, projectTrackTransitionActiveKey, issueFieldEdits.activeEditor?.issueKey].filter(Boolean)),
                getRecentEditKeys: () => new Set([...recentEditKeysRef.current].filter(([, at]) => Date.now() - at < 10000).map(([key]) => key)),
                getViewport: () => ({ top: epicStickyTop + (document.querySelector('.epic-block .epic-header')?.offsetHeight || 0), bottom: window.innerHeight }),
                priorityOrder,
                clearAggregateSources: () => {
                    burnoutCacheRef.current = {}; cohortCacheRef.current = {}; excludedCapacityCacheRef.current = {};
                    setBurnoutData(null); setCohortData(null); setExcludedCapacityData(null);
                },
                afterApply: (update) => {
                    const keys = [...loadedProductTasks, ...loadedTechTasks].filter(task => String(task.fields?.epicKey ?? '') === String(update.epicKey)).map(task => task.key);
                    void refreshEpicDependencies(keys);
                    invalidateStorySubtasks([...update.changedKeys, ...update.addedKeys, ...update.silentKeys]);
                },
                getAlertVersion: () => catchUpAlertVersionRef.current, getSubtaskParentStoryKeys: keys => resolveSubtaskParentStoryKeys(keys, storySubtasksByKey),
                alertCohortInFlight: () => alertCohortRef.current !== null, subscribeAlertCohortSettle, loadEpicAlerts, loadEpicReadiness: storyReadiness.loadEpic, mergeReadinessEpic: storyReadiness.mergeEpic, isFutureSprint: isFutureSprintSelected, track: trackEpicRefreshAction, sourceSurface: isCatchUpMode ? 'catch_up' : 'planning', active: isEpicRefreshMode, capacityScopeHoldRef,
            });

            const engBoardDataProps = strictEngBoardViewProps({ active: boardScopeRequested, owner: strictBoard, model: strictBoardModel, legacyLoading: sprintsLoading || loading, legacyError: displayedEngError, legacyRetry: retryEngLoad });
            if (strictBoardActive && strictBoardData.error?.code === 'board_config_invalid') {
                engBoardDataProps.error = 'Board configuration could not be used. Review Board setup and retry.';
            }
            const renderBlockedBoardScope = () => {
                if (!boardScopeRequested || strictBoardActive) return null;
                const readiness = selectedScopeReadiness === 'catalog_pending'
                    ? 'loading'
                    : selectedScopeReadiness;
                if (readiness === 'loading') {
                    return (
                        <LoadingState
                            className="board-scope-status"
                            title="Loading Board configuration…"
                            ariaLabel="Board scope status"
                        />
                    );
                }
                let content;
                if (readiness === 'error') {
                    content = (
                        <EmptyState title="Board configuration could not be loaded.">
                            <button type="button" onClick={() => void retryBoardScopeConfiguration()}>Retry configuration</button>
                        </EmptyState>
                    );
                } else if (readiness === 'unsupported') {
                    content = <EmptyState title="Cross-sprint Board is unavailable in this environment. Choose a Sprint to continue." />;
                } else if (readiness === 'department_required') {
                    content = (
                        <EmptyState title="Choose a Department to use this Board scope.">
                            <button type="button" onClick={() => openBoardDepartmentSettings('teams')}>Choose a Department</button>
                        </EmptyState>
                    );
                } else if (readiness === 'columns_required') {
                    content = (
                        <EmptyState title="Configure Board columns for this Department.">
                            <button type="button" onClick={() => openBoardDepartmentSettings('boards')}>Configure Board columns</button>
                        </EmptyState>
                    );
                } else if (readiness === 'projects_required') {
                    content = (
                        <EmptyState title="Select Jira projects or a Jira source Board before loading this scope.">
                            {userCanEditSettings === true ? (
                                <button type="button" onClick={openBoardAdminScopeSettings}>Select Jira projects</button>
                            ) : (
                                <p>Ask a workspace tool administrator to configure Jira scope.</p>
                            )}
                        </EmptyState>
                    );
                } else if (readiness === 'components_required') {
                    content = (
                        <EmptyState title="Add Components to this Department to use Component scope.">
                            <button type="button" onClick={() => openBoardDepartmentSettings('teams')}>Add Components</button>
                        </EmptyState>
                    );
                } else {
                    content = (
                        <EmptyState title="Add Teams or Components to this Department to use All work.">
                            <button type="button" onClick={() => openBoardDepartmentSettings('teams')}>Configure Department membership</button>
                        </EmptyState>
                    );
                }
                return (
                    <section className="board-scope-status" role="status" aria-label="Board scope status" aria-live="polite">
                        {content}
                    </section>
                );
            };

            const planningOverview = selectedView === 'eng' && showPlanning && engWorkspaceConfigured && (
                    <PlanningOverviewPanel data-onboarding-target="planning-overview" panelRef={planningPanelRef} compact={compactPlanningPanel} isStuck={isPlanningStuck} capacityStatus={capacityDataStale ? 'Capacity stale — open panel to retry' : capacityReadError ? 'Capacity unavailable — open panel to retry' : ''} table={planningLayout === 'table'}
                        onToggleDetails={() => { setPlanningPanelExpanded(compactPlanningPanel); trackPlanningReviewAction(compactPlanningPanel ? 'panel_expanded' : 'panel_collapsed'); }}
                        onToggleLayout={() => { setPlanningLayout('list'); trackPlanningReviewAction('layout_list'); }}
                        actions={<PlanningActionBar
                            isAcceptedIncluded={isAcceptedIncluded}
                            isTodoIncluded={isTodoIncluded}
                            isPostponedIncluded={isPostponedIncluded}
                            isAwaitingValidationIncluded={isAwaitingValidationIncluded}
                            areAllVisiblePlanningTasksSelected={areAllVisiblePlanningTasksSelected}
                            hasVisibleTasks={visibleTasks.length > 0}
                            hasVisiblePlanningTasks={visibleTasksForList.length > 0}
                            hasPostponedTasks={planningPostponedTasks.length > 0}
                            hasAwaitingValidationTasks={planningAwaitingValidationTasks.length > 0}
                            selectedCount={selectedCount}
                            jiraUrl={jiraUrl}
                            onToggleAccepted={() => toggleIncludeByStatus(['Accepted', 'In Progress'])}
                            onToggleTodo={() => toggleIncludeByStatus(['To Do', 'Pending'])}
                            onTogglePostponed={() => toggleIncludeByStatus(['Postponed'])}
                            onToggleAwaitingValidation={() => toggleIncludeByStatus(['Awaiting Validation'])}
                            onSelectAllVisible={selectAllVisiblePlanningTasks}
                            canUndoPlanningSelection={canUndoPlanningSelection}
                            onUndoPlanningSelection={undoPlanningSelectionChange}
                            onClearSelected={clearSelectedTasks}
                            onOpenSelectedInJira={openSelectedInJira}
                            planningLayout={planningLayout}
                            onTogglePlanningLayout={() => { const next = planningLayout === 'table' ? 'list' : 'table'; setPlanningLayout(next); trackPlanningReviewAction(`layout_${next}`); }}
                            statusTransitionTargetsCount={statusTransitionTargetsCount}
                            statusTransitionSubmitting={statusTransitionSubmitting}
                            statusTransitionError={transitionError}
                            statusTransitionErrorCode={transitionErrorCode}
                            statusTransitionResult={transitionResult}
                        />}
                        capacity={<PlanningCapacityBar compact={compactPlanningPanel}
                            capacityEnabled={capacityEnabled}
                            totalCapacityAdjusted={totalCapacityAdjusted}
                            estimatedCapacityAdjusted={estimatedCapacityAdjusted}
                            excludedCapacityAdjusted={excludedCapacityAdjusted}
                            selectedCount={selectedCount}
                            selectedSP={selectedSP}
                            capacitySummary={capacitySummary}
                        />}
                        teams={<PlanningTeamCapacityCards
                            entries={selectedTeamEntries}
                            capacityEnabled={capacityEnabled}
                            canOpenCapacityJira={authMode === 'atlassian_oauth'}
                            canEditCapacity={authMode === 'atlassian_oauth' && capacityMutationEnabled === true}
                            jiraUrl={jiraUrl}
                            sprintName={selectedSprintInfo?.name || ''}
                            scopeSignature={capacityScopeSignature}
                            capacityReadRevision={capacityReadRevision}
                            capacityLoading={capacityLoading}
                            capacityReadError={capacityReadError}
                            capacityDataStale={capacityDataStale}
                            futureSprintCapacityIssuesMissing={isFutureSprintSelected && effectiveCapacityState.capacityIssueCount === 0}
                            capacityShareLabel={capacityShareLabel}
                            updateCapacityRequest={(issueKey, payload, options) =>
                                updateCapacity(BACKEND_URL, issueKey, payload, options)}
                            onCapacitySaved={handleCapacitySaved}
                            onCapacityRetry={retryCapacity}
                            onAnalyticsAction={trackPlanningCapacityAction}
                            resolveTeamColor={resolveTeamColor}
                            getTeamCapacityMeta={getTeamCapacityMeta}
                        />}
                        projects={<PlanningProjectSplitBar compact={compactPlanningPanel}
                            selectedProjectEntries={selectedProjectEntries}
                            excludedProjectStats={excludedProjectStats}
                            adHocProductSP={selectedAdHocProductSP}
                        />}
                    />
            ); return (
                <StatusColourProvider columns={activeGroup?.board?.columns} enabled={selectedView === 'eng' && activeGroup?.board?.inheritColumnColours === true}>
                <div className="container" style={containerStyle}>
                    <PlanningReviewScopeDialog review={planningReview} />
                    <header ref={headerRef}>
                        <div className="subtitle">
                            <span className="subtitle-main">
                                <img src="epm-burst.svg" alt="" className="subtitle-logo" aria-hidden="true" />
                                Jira Delivery Planner
                                <span className="subtitle-secondary"> · Product &amp; Tech Projects</span>
                                {updateNoticeVisible && (
                                    <button
                                        type="button"
                                        className={`update-badge ${searchPanelActive ? 'compact' : ''}`}
                                        onClick={() => setShowUpdateModal(true)}
                                        aria-label="New version available"
                                        title="A new version is available"
                                    >
                                        {searchPanelActive ? 'Update' : 'New version available'}
                                    </button>
                                )}
                            </span>
                            <div className="header-actions">
                                <div className="header-actions-row">
                                    {renderViewSwitch()}
                                    {renderSearchControl('main')}
                                    {!(boardScopeRequested && !strictBoardActive) && (
                                        <JiraExportButton
                                            onboardingTarget="jira-export"
                                            jiraUrl={jiraUrl}
                                            epicKeys={activeJiraExportEpicKeys}
                                            storyKeys={activeJiraExportStoryKeys}
                                            workItemKeys={strictBoardActive ? activeJiraExportWorkItemKeys : undefined}
                                            className="jira-export-header"
                                            sourceSurface={selectedView === 'epm' ? 'epm' : (showScenario ? 'scenario' : showStats ? 'stats' : showPlanning ? 'planning' : showBoard ? 'board' : 'catch_up')}
                                        />
                                    )}
                                    <IconButton
                                        variant="secondary compact"
                                        className="header-icon-button refresh-icon"
                                        isLoading={selectedView === 'epm' && epmProjectsLoading}
                                        onClick={refreshActiveViewFromJira}
                                        disabled={manualRefreshDisabled}
                                        title={selectedView === 'eng' ? 'Refresh tasks and sprints from Jira' : 'Refresh EPM projects and issues from Jira'}
                                        aria-label={selectedView === 'eng' ? 'Refresh tasks and sprints from Jira' : 'Refresh EPM projects and issues from Jira'}
                                        data-onboarding-target="refresh"
                                        data-onboarding-surface="main"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="M19 7.5a7.5 7.5 0 1 0 2 5.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
                                            <path d="M19 3v4h-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </IconButton>
                                    {selectedView === 'eng' && (
                                        <button
                                            ref={groupManageButtonRef}
                                            className="header-icon-button group-gear-button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                trackSettingsAction('teams', 'open', { source_surface: 'dashboard' });
                                                const configurationTourRequested = onboardingBootstrapReady
                                                    && !isDashboardMobileViewport()
                                                    && onboarding.requestModule('configuration');
                                                openGroupManage(configurationTourRequested ? 'teams' : preferredSettingsTab);
                                            }}
                                            disabled={groupsLoading}
                                            title="Manage team groups"
                                            aria-label="Manage team groups"
                                            type="button"
                                            data-onboarding-target="settings-launcher"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" stroke="currentColor" strokeWidth="1.6"/>
                                                <path d="M19.4 12a7.5 7.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.1-1.2l-.4-2.6H9.6l-.4 2.6a7.4 7.4 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0-.1 1.2c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2l.4 2.6h4.8l.4-2.6c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        </button>
                                    )}
                                    {selectedView === 'epm' && canEditEpmConfiguration && (
                                        <button
                                            className="header-icon-button group-gear-button"
                                            onClick={openEpmSettingsTab}
                                            title="Open EPM settings"
                                            aria-label="Open EPM settings"
                                            type="button"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" stroke="currentColor" strokeWidth="1.6"/>
                                                <path d="M19.4 12a7.5 7.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.1-1.2l-.4-2.6H9.6l-.4 2.6a7.4 7.4 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0-.1 1.2c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2l.4 2.6h4.8l.4-2.6c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    <div className="view-selector">
                        <div className="controls-label">Controls</div>
                        <div className="view-filters">
                                {selectedView === 'eng' && (
                                    <>
                                        {renderSprintControl('main')}
                                        {renderGroupControl('main')}
                                        {renderTeamControl('main')}
                                        {renderEngModeControl()}
                                    </>
                                )}
                                {selectedView === 'epm' && (
                                    <>
                                        {shouldUseEpmSprint(epmTab) && renderSprintControl('main')}
                                        {renderEpmControls('main')}
                                    </>
                                )}
                            </div>
                        </div>
                    </header>

                    {selectedView === 'eng' && sprintCatalogWarning && (
                        <section className="board-scope-status" role="status" aria-label="Sprint catalog status" aria-live="polite">
                            <span>{sprintCatalogWarning}</span>
                            <button type="button" onClick={() => void loadSprints(true)}>Retry</button>
                        </section>
                    )}

                    <div
                        ref={compactHeaderRef}
                        className={`compact-sticky-header ${compactStickyVisible ? 'is-visible' : ''}`}
                        aria-hidden={!compactStickyVisible}
                    >
                        {compactStickyVisible && (
                            <>
                                <div className="compact-sticky-header-controls">
                                    {selectedView === 'eng' ? (
                                        <>
                                            {renderSprintControl('compact')}
                                            {renderGroupControl('compact')}
                                            {renderTeamControl('compact')}
                                            {renderEngModeControl()}
                                        </>
                                    ) : (
                                        <>
                                            {shouldUseEpmSprint(epmTab) && renderSprintControl('compact')}
                                            {renderEpmControls('compact', { showProjectPicker: true, showStateControl: false })}
                                        </>
                                    )}
                                </div>
                                <div className="compact-sticky-header-search">
                                    {renderSearchControl('compact', 'compact-sticky-header-search-field')}
                                </div>
                            </>
                        )}
                    </div>

                    {shouldRenderEngTaskList && !sprintsLoading && <EngFilterControls planningToolbarRef={setPlanningToolbarHost}
                        engFilters={engCatchUpFilters} boardColumns={activeGroup?.board?.columns || []} renderPriorityIcon={renderPriorityIcon} onFacetChange={handleEngFacetChange} onClearFacets={clearEngFacetFilters} onFilterBarHeightChange={handleFilterBarHeightChange}
                        hasInitiativeData={hasInitiativeData} groupByInitiative={groupByInitiative} setGroupByInitiative={setGroupByInitiativeChoice} InitiativeIcon={InitiativeIcon}
                        engEpicSort={engEpicSort} setEngEpicSort={handleEngEpicSortChange} hierarchyCounts={engWorkHierarchy.counts} visibleTasksForList={visibleTasksForList}
                        planningTable={showPlanning && planningLayout === 'table'} planningOverview={planningOverview} compactHeaderRef={compactHeaderRef} onActivatePlanningSticky={() => setCompactStickyVisible(true)} />}

                    <ServerUnavailableBanner
                        message={serverConnectionError}
                        status={connectionRecoveryStatus}
                        onRetry={() => recoverServerConnection({ manual: true })}
                    />

                    <ConnectionRecoveryNotice
                        notice={connectionRecoveryNotice}
                        onRecover={() => setConnectionRecoveryStagedRevision(revision => revision + 1)}
                        onDiscard={discardConnectionRecovery}
                        onDismiss={() => setConnectionRecoveryNotice(null)}
                        onReloadDiscard={() => recoverServerConnection({ manual: true, discardUnsaved: true })}
                    />

                    {selectedView === 'eng' && !engWorkspaceConfigured && <UnconfiguredWorkspaceNotice canEditSettings={canEditSharedConfiguration} adminContacts={adminSettingsGate.contacts} onOpenSettings={() => openGroupManage(firstMissingAdminSettingsTab(adminSettingsGate.missing))} />}

                    {selectedView === 'eng' && !showBoard && !isCompletedSprintSelected && engWorkspaceConfigured && (
                        <div className={`capacity-panel ${showPlanning ? 'open' : ''}${showPlanning && planningLayout === 'table' && !teamsEffortExpanded ? ' capacity-panel-collapsed' : ''}`}>
                            {showPlanning && planningLayout === 'table' ? (
                                <button type="button" className="capacity-header capacity-header-toggle" aria-expanded={teamsEffortExpanded} onClick={() => setTeamsEffortExpanded(expanded => !expanded)}>
                                    <span className="capacity-title">Planned Teams Effort (Story Points)<span className="capacity-panel-caret" aria-hidden="true">▸</span></span>
                                    <span className="capacity-subtitle">1 SP ≈ 2 days of work</span>
                                </button>
                            ) : (
                                <div className="capacity-header">
                                    <div className="capacity-title">Planned Teams Effort (Story Points)</div>
                                    <div className="capacity-subtitle">1 SP ≈ 2 days of work</div>
                                </div>
                            )}
                            <div className="capacity-grid-wrapper">
                                <div className="capacity-grid">
                                    <div className="capacity-row capacity-group-row">
                                        <div className="capacity-cell"></div>
                                        <div className="capacity-group-cell product">Product</div>
                                        <div className="capacity-group-cell tech">Tech</div>
                                        <div className="capacity-group-cell total">Total</div>
                                    </div>
                                    <div className="capacity-row capacity-header-row">
                                        <div className="capacity-cell">Team</div>
                                        <div className="capacity-cell metric product-col">To Do / Pending</div>
                                        <div className="capacity-cell metric product-col">Postponed</div>
                                        <div className="capacity-cell metric product-col divider-right">Accepted</div>
                                        <div className="capacity-cell metric tech-col">To Do / Pending</div>
                                        <div className="capacity-cell metric tech-col">Postponed</div>
                                        <div className="capacity-cell metric tech-col divider-right">Accepted</div>
                                        <div className="capacity-cell metric total-col">To Do / Pending</div>
                                        <div className="capacity-cell metric total-col">Postponed</div>
                                        <div className="capacity-cell metric total-col divider-right">Accepted</div>
                                    </div>
                                    {displayedTeamCapacityEntries.map((info) => (
                                        <div key={info.id} className="capacity-row capacity-divider">
                                            <EpicHeaderValueReadout value={info.name}>
                                                {({ discoveryProps }) => (
                                                    <div {...discoveryProps} className="capacity-cell capacity-team epic-full-value-trigger">{info.name}</div>
                                                )}
                                            </EpicHeaderValueReadout>
                                            <div className="capacity-cell metric product-col">
                                                <div className="postponed-cell">
                                                    <span className={getMetricClass(info.product.todoPending, 'todo', info.product.accepted)}>
                                                        {formatCapacityValue(info.product.todoPending)}
                                                    </span>
                                                    {buildTodoPendingLink({ teamId: info.id, projectName: 'PRODUCT ROADMAPS' }) && (
                                                        <a
                                                            className="todo-link"
                                                            href={buildTodoPendingLink({ teamId: info.id, projectName: 'PRODUCT ROADMAPS' })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View To Do / Pending tasks for this team in Jira"
                                                            aria-label="Open To Do / Pending tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="capacity-cell metric product-col">
                                                <div className="postponed-cell">
                                                    <span className="metric-value">
                                                        {formatCapacityValue(info.product.postponed)}
                                                    </span>
                                                    {buildPostponedLink({ teamId: info.id, projectName: 'PRODUCT ROADMAPS' }) && (
                                                        <a
                                                            className="postponed-link"
                                                            href={buildPostponedLink({ teamId: info.id, projectName: 'PRODUCT ROADMAPS' })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View postponed tasks for this team in Jira"
                                                            aria-label="Open postponed tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="capacity-cell metric product-col divider-right">
                                                <div className="postponed-cell">
                                                    <span className={getMetricClass(info.product.accepted, 'accepted')}>
                                                        {formatCapacityValue(info.product.accepted)}
                                                    </span>
                                                    {buildAcceptedLink({ teamId: info.id, projectName: 'PRODUCT ROADMAPS' }) && (
                                                        <a
                                                            className="accepted-link"
                                                            href={buildAcceptedLink({ teamId: info.id, projectName: 'PRODUCT ROADMAPS' })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View accepted tasks for this team in Jira"
                                                            aria-label="Open accepted tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="capacity-cell metric tech-col">
                                                <div className="postponed-cell">
                                                    <span className={getMetricClass(info.tech.todoPending, 'todo', info.tech.accepted)}>
                                                        {formatCapacityValue(info.tech.todoPending)}
                                                    </span>
                                                    {buildTodoPendingLink({ teamId: info.id, projectName: 'TECHNICAL ROADMAP' }) && (
                                                        <a
                                                            className="todo-link"
                                                            href={buildTodoPendingLink({ teamId: info.id, projectName: 'TECHNICAL ROADMAP' })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View To Do / Pending tasks for this team in Jira"
                                                            aria-label="Open To Do / Pending tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="capacity-cell metric tech-col">
                                                <div className="postponed-cell">
                                                    <span className="metric-value">
                                                        {formatCapacityValue(info.tech.postponed)}
                                                    </span>
                                                    {buildPostponedLink({ teamId: info.id, projectName: 'TECHNICAL ROADMAP' }) && (
                                                        <a
                                                            className="postponed-link"
                                                            href={buildPostponedLink({ teamId: info.id, projectName: 'TECHNICAL ROADMAP' })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View postponed tasks for this team in Jira"
                                                            aria-label="Open postponed tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="capacity-cell metric tech-col divider-right">
                                                <div className="postponed-cell">
                                                    <span className={getMetricClass(info.tech.accepted, 'accepted')}>
                                                        {formatCapacityValue(info.tech.accepted)}
                                                    </span>
                                                    {buildAcceptedLink({ teamId: info.id, projectName: 'TECHNICAL ROADMAP' }) && (
                                                        <a
                                                            className="accepted-link"
                                                            href={buildAcceptedLink({ teamId: info.id, projectName: 'TECHNICAL ROADMAP' })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View accepted tasks for this team in Jira"
                                                            aria-label="Open accepted tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="capacity-cell metric total-col">
                                                <div className="postponed-cell">
                                                    <span className={getMetricClass(info.total.todoPending, 'todo', info.total.accepted)}>
                                                        {formatCapacityValue(info.total.todoPending)}
                                                    </span>
                                                    {buildTodoPendingLink({ teamId: info.id, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] }) && (
                                                        <a
                                                            className="todo-link"
                                                            href={buildTodoPendingLink({ teamId: info.id, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View To Do / Pending tasks for this team in Jira"
                                                            aria-label="Open To Do / Pending tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="capacity-cell metric total-col">
                                                <div className="postponed-cell">
                                                    <span className="metric-value">
                                                        {formatCapacityValue(info.total.postponed)}
                                                    </span>
                                                    {buildPostponedLink({ teamId: info.id, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] }) && (
                                                        <a
                                                            className="postponed-link"
                                                            href={buildPostponedLink({ teamId: info.id, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View postponed tasks for this team in Jira"
                                                            aria-label="Open postponed tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="capacity-cell metric total-col divider-right">
                                                <div className="postponed-cell">
                                                    <span className={getMetricClass(info.total.accepted, 'accepted')}>
                                                        {formatCapacityValue(info.total.accepted)}
                                                    </span>
                                                    {buildAcceptedLink({ teamId: info.id, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] }) && (
                                                        <a
                                                            className="accepted-link"
                                                            href={buildAcceptedLink({ teamId: info.id, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View accepted tasks for this team in Jira"
                                                            aria-label="Open accepted tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {showTotalsRow && displayedTeamCapacityEntries.length > 0 && (
                                        <div className="capacity-row capacity-divider">
                                            <div className="capacity-cell capacity-team capacity-total">Total</div>
                                        <div className="capacity-cell metric product-col capacity-total">
                                            <div className="postponed-cell">
                                                <span className={getMetricClass(capacityTotals.product.todoPending, 'todo', capacityTotals.product.accepted)}>
                                                    {formatCapacityValue(capacityTotals.product.todoPending)}
                                                </span>
                                                {buildTodoPendingLink({ teamIds: capacityTeamIds, projectName: 'PRODUCT ROADMAPS' }) && (
                                                    <a
                                                        className="todo-link"
                                                        href={buildTodoPendingLink({ teamIds: capacityTeamIds, projectName: 'PRODUCT ROADMAPS' })}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View To Do / Pending tasks for selected teams in Jira"
                                                        aria-label="Open To Do / Pending tasks in Jira"
                                                    >
                                                        ↗
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="capacity-cell metric product-col capacity-total">
                                            <div className="postponed-cell">
                                                <span className="metric-value">
                                                    {formatCapacityValue(capacityTotals.product.postponed)}
                                                </span>
                                                {buildPostponedLink({ teamIds: capacityTeamIds, projectName: 'PRODUCT ROADMAPS' }) && (
                                                    <a
                                                        className="postponed-link"
                                                        href={buildPostponedLink({ teamIds: capacityTeamIds, projectName: 'PRODUCT ROADMAPS' })}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View postponed tasks for selected teams in Jira"
                                                        aria-label="Open postponed tasks in Jira"
                                                    >
                                                        ↗
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="capacity-cell metric product-col divider-right capacity-total">
                                            <div className="postponed-cell">
                                                <span className={getMetricClass(capacityTotals.product.accepted, 'accepted')}>
                                                    {formatCapacityValue(capacityTotals.product.accepted)}
                                                </span>
                                                {buildAcceptedLink({ teamIds: capacityTeamIds, projectName: 'PRODUCT ROADMAPS' }) && (
                                                    <a
                                                        className="accepted-link"
                                                        href={buildAcceptedLink({ teamIds: capacityTeamIds, projectName: 'PRODUCT ROADMAPS' })}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View accepted tasks for selected teams in Jira"
                                                        aria-label="Open accepted tasks in Jira"
                                                    >
                                                        ↗
                                                    </a>
                                                )}
                                            </div>
                                            </div>

                                        <div className="capacity-cell metric tech-col capacity-total">
                                            <div className="postponed-cell">
                                                <span className={getMetricClass(capacityTotals.tech.todoPending, 'todo', capacityTotals.tech.accepted)}>
                                                    {formatCapacityValue(capacityTotals.tech.todoPending)}
                                                </span>
                                                {buildTodoPendingLink({ teamIds: capacityTeamIds, projectName: 'TECHNICAL ROADMAP' }) && (
                                                    <a
                                                        className="todo-link"
                                                        href={buildTodoPendingLink({ teamIds: capacityTeamIds, projectName: 'TECHNICAL ROADMAP' })}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View To Do / Pending tasks for selected teams in Jira"
                                                        aria-label="Open To Do / Pending tasks in Jira"
                                                    >
                                                        ↗
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="capacity-cell metric tech-col capacity-total">
                                            <div className="postponed-cell">
                                                <span className="metric-value">
                                                    {formatCapacityValue(capacityTotals.tech.postponed)}
                                                </span>
                                                {buildPostponedLink({ teamIds: capacityTeamIds, projectName: 'TECHNICAL ROADMAP' }) && (
                                                    <a
                                                        className="postponed-link"
                                                        href={buildPostponedLink({ teamIds: capacityTeamIds, projectName: 'TECHNICAL ROADMAP' })}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View postponed tasks for selected teams in Jira"
                                                        aria-label="Open postponed tasks in Jira"
                                                    >
                                                        ↗
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="capacity-cell metric tech-col divider-right capacity-total">
                                            <div className="postponed-cell">
                                                <span className={getMetricClass(capacityTotals.tech.accepted, 'accepted')}>
                                                    {formatCapacityValue(capacityTotals.tech.accepted)}
                                                </span>
                                                {buildAcceptedLink({ teamIds: capacityTeamIds, projectName: 'TECHNICAL ROADMAP' }) && (
                                                    <a
                                                        className="accepted-link"
                                                        href={buildAcceptedLink({ teamIds: capacityTeamIds, projectName: 'TECHNICAL ROADMAP' })}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View accepted tasks for selected teams in Jira"
                                                        aria-label="Open accepted tasks in Jira"
                                                    >
                                                        ↗
                                                    </a>
                                                )}
                                            </div>
                                            </div>

                                        <div className="capacity-cell metric total-col capacity-total">
                                            <div className="postponed-cell">
                                                <span className={getMetricClass(capacityTotals.total.todoPending, 'todo', capacityTotals.total.accepted)}>
                                                    {formatCapacityValue(capacityTotals.total.todoPending)}
                                                </span>
                                                {buildTodoPendingLink({ teamIds: capacityTeamIds, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] }) && (
                                                    <a
                                                        className="todo-link"
                                                        href={buildTodoPendingLink({ teamIds: capacityTeamIds, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] })}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View To Do / Pending tasks for selected teams in Jira"
                                                        aria-label="Open To Do / Pending tasks in Jira"
                                                    >
                                                        ↗
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="capacity-cell metric total-col capacity-total">
                                            <div className="postponed-cell">
                                                <span className="metric-value">
                                                    {formatCapacityValue(capacityTotals.total.postponed)}
                                                </span>
                                                {buildPostponedLink({ teamIds: capacityTeamIds, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] }) && (
                                                    <a
                                                        className="postponed-link"
                                                        href={buildPostponedLink({ teamIds: capacityTeamIds, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] })}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View postponed tasks for selected teams in Jira"
                                                        aria-label="Open postponed tasks in Jira"
                                                    >
                                                        ↗
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                            <div className="capacity-cell metric total-col divider-right capacity-total">
                                                <div className="postponed-cell">
                                                    <span className={getMetricClass(capacityTotals.total.accepted, 'accepted')}>
                                                        {formatCapacityValue(capacityTotals.total.accepted)}
                                                    </span>
                                                    {buildAcceptedLink({ teamIds: capacityTeamIds, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] }) && (
                                                        <a
                                                            className="accepted-link"
                                                            href={buildAcceptedLink({ teamIds: capacityTeamIds, projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'] })}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="View accepted tasks for selected teams in Jira"
                                                            aria-label="Open accepted tasks in Jira"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {displayedTeamCapacityEntries.length === 0 && (
                                        <div className="capacity-empty">No capacity data for current filters.</div>
                                    )}
                                </div>
                                {displayedTeamCapacityEntries.length > 5 && (
                                    <div className="capacity-scroll-hint">Scroll for more teams</div>
                                )}
                            </div>
                        </div>
                    )}

                    {selectedView === 'eng' && showStats && engWorkspaceConfigured && (
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
                    )}

                    {selectedView === 'eng' && showScenario && engWorkspaceConfigured && (
                        <ScenarioView
                            scenario={scenario}
                            scenarioState={scenarioState}
                            selectedSprint={selectedSprint}
                            normalizeEpicKey={normalizeEpicKey}
                            excludedEpicSet={excludedEpicSet}
                        />
                    )}

                    {selectedView === 'eng' && showBoard && engWorkspaceConfigured && (
                        boardScopeRequested && !strictBoardActive ? renderBlockedBoardScope() : (
                            <EngBoardView
                                board={activeGroup?.board || null}
                                epicGroups={boardEpicGroupsFiltered}
                                {...engBoardDataProps}
                                view={boardView}
                                onViewChange={setBoardView}
                                renderPriorityIcon={renderPriorityIcon}
                                engFilters={boardFilters}
                                onFacetChange={setEngBoardFilterSelection}
                                onFilterBarHeightChange={handleFilterBarHeightChange}
                                jiraUrl={jiraUrl}
                                backendUrl={BACKEND_URL}
                                transitionsEnabled={statusTransitionEnabled
                                    && (!boardScopeRequested || strictBoardModel.childrenAuthoritative)}
                                statusTransitions={statusTransitions}
                                priorityTransitions={priorityTransitions}
                                projectTrackTransitions={projectTrackTransitions}
                                statusTransitionSubmitting={statusTransitionSubmitting}
                                onSubmitStatusTransition={handleSubmitStatusTransition}
                                issueFieldEdits={issueFieldEditsEnabled ? issueFieldEdits : null}
                                onConfigure={() => {
                                    trackSettingsAction('boards', 'open', { source_surface: 'board' });
                                    setShowGroupManage(true);
                                    selectDepartmentSettingsTab('boards');
                                }}
                            />
                        )
                    )}
                    {!isLeadTimesFocusMode && (
                        <>
                            {shouldRenderEngTaskList && showBackToTop && (
                                <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                                    Back to top
                                </button>
                            )}
                            {isEpicRefreshMode && <div className="epic-refresh-status" role="status" data-epic-refresh-status>{epicRefresh.announcement}</div>}

                            {shouldRenderEngTaskList && (
                                <EngView
                                    selectedView={selectedView} sprintCatalogLoading={sprintsLoading} InitiativeIcon={InitiativeIcon}
                                    planningTable={showPlanning && planningLayout === 'table' ? <PlanningReviewTable toolbarHost={planningToolbarHost}
                                        epicGroups={epicGroups} visibleTasks={visibleTasksForList}
                                        selectedStoryKeys={new Set(Object.keys(selectedTasks).filter(key => selectedTasks[key]))}
                                        onToggleStory={task => toggleTaskSelection(task.key)} onSelectStories={selectPlanningReviewStories}
                                        jiraUrl={jiraUrl} sprintId={selectedSprint} review={planningReview} getTeamInfo={getTeamInfo} excludedEpicSet={excludedEpicSet}
                                        admittedTeamCount={planningReviewAdmittedCounts.teams} admittedProjectCount={planningReviewAdmittedCounts.projects}
                                        renderPriorityIcon={renderPriorityIcon} renderFieldEditor={renderPlanningReviewFieldEditor} onReviewAction={trackPlanningReviewAction}
                                    /> : null}
                                    productTasksLoading={productTasksLoading}
                                    techTasksLoading={techTasksLoading}
                                    loading={loading}
                                    error={displayedEngError}
                                    onRetry={retryEngLoad}
                                    alertCelebrationPieces={alertCelebrationPieces}
                                    alertsPanel={isCatchUpMode ? (
                                        <EngAlertsPanel
                                            selectedView={selectedView}
                                            alertItemCount={alertItemCount}
                                            alertCounts={alertCounts}
                                            alertScopeTooLarge={alertScopeTooLarge}
                                            showAlertsPanel={showAlertsPanel}
                                            setShowAlertsPanel={setShowAlertsPanel}
                                            collapsed={!showMissingAlert && !showBlockedAlert && !showPostponedAlert && !showBacklogAlert && !showMissingTeamAlert && !showMissingLabelsAlert && !showNeedsStoriesAlert && !showWaitingAlert && !showEmptyEpicAlert && !showDoneEpicAlert}
                                            alertProps={{
                                                analysisEpicTeams,
                                                backlogEpicTeams,
                                                backlogEpics: visibleAlertCollections.backlogEpics,
                                                blockedAlertTeams,
                                                blockedTasks: visibleAlertCollections.blockedTasks,
                                                buildKeyListLink,
                                                buildTeamStatusLink,
                                                consolidatedMissingStories: visibleAlertCollections.consolidatedMissingStories,
                                                dismissAlertItem,
                                                doneEpicTeams,
                                                doneStoryEpics: visibleAlertCollections.doneStoryEpics,
                                                emptyEpicTeams,
                                                emptyEpics: visibleAlertCollections.emptyEpicsForAlert,
                                                emptyEpicsForAlert: visibleAlertCollections.emptyEpicsForAlert,
                                                futureRoutedEpics: visibleAlertCollections.futureRoutedEpics,
                                                getBlockedAlertStatusLabel,
                                                getFuturePlanningNeedsStoriesReasonText,
                                                handleAlertStoryClick,
                                                handleStoryRequirementClick,
                                                dismissStoryRequirement,
                                                isFutureSprintSelected,
                                                storyReadinessSprintState: selectedSprintState,
                                                jiraUrl,
                                                missingAlertTeams,
                                                missingLabelEpicTeams,
                                                missingLabelEpics: visibleAlertCollections.missingLabelEpics,
                                                missingTeamEpicTeams,
                                                missingTeamEpics: visibleAlertCollections.missingTeamEpics,
                                                needsStoriesEntries: visibleAlertCollections.needsStoriesEntries,
                                                needsStoriesEpics: visibleAlertCollections.needsStoriesEpics,
                                                needsStoriesTeams,
                                                postponedAlertTeams,
                                                postponedEpicTeams,
                                                postponedTasks: visibleAlertCollections.postponedTasks,
                                                setShowBacklogAlert,
                                                setShowBlockedAlert,
                                                setShowDoneEpicAlert,
                                                setShowEmptyEpicAlert,
                                                setShowMissingAlert,
                                                setShowMissingLabelsAlert,
                                                setShowMissingTeamAlert,
                                                setShowNeedsStoriesAlert,
                                                setShowPostponedAlert,
                                                setShowWaitingAlert,
                                                showBacklogAlert,
                                                showBlockedAlert,
                                                showDoneEpicAlert,
                                                showEmptyEpicAlert,
                                                showMissingAlert,
                                                showMissingLabelsAlert,
                                                showMissingTeamAlert,
                                                showNeedsStoriesAlert,
                                                showPostponedAlert,
                                                showWaitingAlert,
                                                waitingForStoriesEpics: visibleAlertCollections.waitingForStoriesEpics,
                                            }}
                                        />
                                    ) : null}
                                    visibleTasksForList={visibleTasksForList}
                                    hierarchyCounts={engWorkHierarchy.counts}
                                    readinessStatus={storyReadiness.status}
                                    readinessError={storyReadinessMessage}
                                    onRetryReadiness={storyReadiness.retry}
                                    activeDependencyFocus={activeDependencyFocus}
                                    handleDependencyFocusClick={handleDependencyFocusClick}
                                    initiativeGroups={initiativeGroups}
                                    epicGroups={epicGroups}
                                    renderEpicBlock={renderEpicBlock}
                                    jiraUrl={jiraUrl}
                                    onClearFilters={clearEngFilters}
                                    setEngEpicSort={handleEngEpicSortChange}
                                />
                            )}

                            <IssueCardContext.Provider value={issueCardContext}>
                                <EpmView
                                    selectedView={selectedView}
                                    epmConfigLoaded={epmConfigLoaded}
                                    epmProjectsLoading={epmProjectsLoading}
                                    epmRollupBoards={epmRollupBoards}
                                    epmRollupTree={epmRollupTree}
                                    epmSelectedProjectId={epmSelectedProjectId}
                                    selectedEpmProject={selectedEpmProject}
                                    selectedEpmProjectUpdateLine={selectedEpmProjectUpdateLine}
                                    epmTab={epmTab}
                                    selectedSprint={selectedSprint}
                                    epmRollupLoading={epmRollupLoading}
                                    visibleEpmRollupBoards={visibleEpmRollupBoards}
                                    epmDuplicates={epmDuplicates}
                                    epmAggregateTruncated={epmAggregateTruncated}
                                    epmProjectRollupLoadingIds={epmProjectRollupLoadingIds}
                                    collapsedProjectIds={epmCollapsedProjectIds}
                                    setCollapsedProjectIds={setEpmCollapsedProjectIds}
                                    searchQuery={searchQuery}
                                    loadArchivedEpmProjectRollup={loadArchivedEpmProjectRollup}
                                    openEpmSettingsTab={openEpmSettingsTab}
                                    jiraUrl={jiraUrl}
                                    InitiativeIcon={InitiativeIcon}
                                />
                            </IssueCardContext.Provider>
                        </>
                    )}

                    {showGroupManage && (
                        <SettingsModalContainer
                            activeSettingsModalTab={activeSettingsModalTab}
                            canEditEpmConfiguration={canEditEpmConfiguration}
                            cancelFirstRunConfiguration={cancelFirstRunConfiguration}
                            discardGroupDraftChanges={discardGroupDraftChanges}
                            discardMineOnGroupsConfigConflict={discardMineOnGroupsConfigConflict}
                            firstRunConfigurationActive={firstRunConfigurationActive}
                            firstRunHasCommittedSection={firstRunHasCommittedSection}
                            groupConfigValidationErrors={groupConfigValidationErrors}
                            groupDraftError={groupDraftError}
                            groupManageTab={groupManageTab}
                            groupTestMessage={groupTestMessage}
                            groupTesting={groupTesting}
                            groupsConfigConflict={groupsConfigConflict}
                            isEpmConfigDirty={isEpmConfigDirty}
                            isGroupBoardDraftDirty={isGroupBoardDraftDirty}
                            isGroupDraftDirty={isGroupDraftDirty}
                            isGroupVisibilityDraftDirty={isGroupVisibilityDraftDirty}
                            keepMineOnGroupsConfigConflict={keepMineOnGroupsConfigConflict}
                            keepMineOnWorkspaceConfigConflict={keepMineOnWorkspaceConfigConflict}
                            requestCloseGroupManage={requestCloseGroupManage}
                            setShowGroupDiscardConfirm={setShowGroupDiscardConfirm}
                            settingsHeaderAction={settingsHeaderAction}
                            settingsModalTabs={settingsModalTabs}
                            settingsSaveDisabled={settingsSaveDisabled}
                            settingsSaveError={settingsSaveError}
                            settingsSaveHandler={settingsSaveHandler}
                            settingsSaveLabel={settingsSaveLabel}
                            settingsSaveTitle={settingsSaveTitle}
                            settingsShowsSave={settingsShowsSave}
                            showGroupDiscardConfirm={showGroupDiscardConfirm}
                            testGroupsConfigConnection={testGroupsConfigConnection}
                            unsavedSectionsCount={unsavedSectionsCount}
                            useLatestWorkspaceConfig={useLatestWorkspaceConfig}
                            workspaceConfigConflict={workspaceConfigConflict}
                        >
                                {groupManageTab === 'connections' && (
                                <UserConnectionsSettings
                                    backendUrl={BACKEND_URL}
                                    onConnectionChange={handleHomeTokenConnectionChange}
                                />
                                )}
                                {ADMIN_SETTINGS_TAB_IDS.has(groupManageTab) && (
                                <AdminSettingsContainer
                                    BACKEND_URL={BACKEND_URL}
                                    addIssueType={addIssueType}
                                    addProjectSelection={addProjectSelection}
                                    adminAccess={adminAccess}
                                    adminAccessAvailable={adminAccessAvailable}
                                    adminUserManagementAvailable={adminUserManagementAvailable}
                                    authMode={authMode}
                                    boardIdDraft={boardIdDraft}
                                    boardNameDraft={boardNameDraft}
                                    boardSearchIndex={boardSearchIndex}
                                    boardSearchInputRef={boardSearchInputRef}
                                    boardSearchOpen={boardSearchOpen}
                                    boardSearchQuery={boardSearchQuery}
                                    boardSearchRemoteLoading={boardSearchRemoteLoading}
                                    boardSearchResults={boardSearchResults}
                                    capacityFieldIdDraft={capacityFieldIdDraft}
                                    capacityFieldNameDraft={capacityFieldNameDraft}
                                    capacityFieldSearchHidden={capacityFieldSearchHidden}
                                    capacityFieldSearchIndex={capacityFieldSearchIndex}
                                    capacityFieldSearchInputRef={capacityFieldSearchInputRef}
                                    capacityFieldSearchOpen={capacityFieldSearchOpen}
                                    capacityFieldSearchQuery={capacityFieldSearchQuery}
                                    capacityFieldSearchResults={capacityFieldSearchResults}
                                    capacityProjectDraft={capacityProjectDraft}
                                    capacityProjectSearchIndex={capacityProjectSearchIndex}
                                    capacityProjectSearchInputRef={capacityProjectSearchInputRef}
                                    capacityProjectSearchOpen={capacityProjectSearchOpen}
                                    capacityProjectSearchQuery={capacityProjectSearchQuery}
                                    capacityProjectSearchResults={capacityProjectSearchResults}
                                    clearBoardSelection={clearBoardSelection}
                                    deliveryOwnerFieldIdDraft={deliveryOwnerFieldIdDraft}
                                    deliveryOwnerFieldNameDraft={deliveryOwnerFieldNameDraft}
                                    deliveryOwnerFieldSearchHidden={deliveryOwnerFieldSearchHidden}
                                    deliveryOwnerFieldSearchIndex={deliveryOwnerFieldSearchIndex}
                                    deliveryOwnerFieldSearchInputRef={deliveryOwnerFieldSearchInputRef}
                                    deliveryOwnerFieldSearchOpen={deliveryOwnerFieldSearchOpen}
                                    deliveryOwnerFieldSearchQuery={deliveryOwnerFieldSearchQuery}
                                    deliveryOwnerFieldSearchResults={deliveryOwnerFieldSearchResults}
                                    groupManageTab={groupManageTab}
                                    handleAdminSettingsTabKeyDown={handleAdminSettingsTabKeyDown}
                                    handleBoardSearchKeyDown={handleBoardSearchKeyDown}
                                    handleCapacityFieldSearchKeyDown={handleCapacityFieldSearchKeyDown}
                                    handleCapacityProjectSearchKeyDown={handleCapacityProjectSearchKeyDown}
                                    handleDeliveryOwnerFieldSearchKeyDown={handleDeliveryOwnerFieldSearchKeyDown}
                                    handleIssueTypeSearchKeyDown={handleIssueTypeSearchKeyDown}
                                    handleParentNameFieldSearchKeyDown={handleParentNameFieldSearchKeyDown}
                                    handleProjectSearchKeyDown={handleProjectSearchKeyDown}
                                    handleSprintFieldSearchKeyDown={handleSprintFieldSearchKeyDown}
                                    handleStoryPointsFieldSearchKeyDown={handleStoryPointsFieldSearchKeyDown}
                                    handleTeamFieldSearchKeyDown={handleTeamFieldSearchKeyDown}
                                    issueTypeSearchIndex={issueTypeSearchIndex}
                                    issueTypeSearchInputRef={issueTypeSearchInputRef}
                                    issueTypeSearchOpen={issueTypeSearchOpen}
                                    issueTypeSearchQuery={issueTypeSearchQuery}
                                    issueTypeSearchResults={issueTypeSearchResults}
                                    issueTypesDraft={issueTypesDraft}
                                    jiraFields={jiraFields}
                                    jiraProjects={jiraProjects}
                                    loadingFields={loadingFields}
                                    loadingProjects={loadingProjects}
                                    mappingHoverKey={mappingHoverKey}
                                    parentNameFieldIdDraft={parentNameFieldIdDraft}
                                    parentNameFieldNameDraft={parentNameFieldNameDraft}
                                    parentNameFieldSearchHidden={parentNameFieldSearchHidden}
                                    parentNameFieldSearchIndex={parentNameFieldSearchIndex}
                                    parentNameFieldSearchInputRef={parentNameFieldSearchInputRef}
                                    parentNameFieldSearchOpen={parentNameFieldSearchOpen}
                                    parentNameFieldSearchQuery={parentNameFieldSearchQuery}
                                    parentNameFieldSearchResults={parentNameFieldSearchResults}
                                    performanceAdminAvailable={performanceAdminAvailable}
                                    priorityWeightsDraft={priorityWeightsDraft}
                                    priorityWeightsSource={priorityWeightsSource}
                                    priorityWeightsSum={priorityWeightsSum}
                                    priorityWeightsValidationError={priorityWeightsValidationError}
                                    projectSearchIndex={projectSearchIndex}
                                    projectSearchInputRef={projectSearchInputRef}
                                    projectSearchOpen={projectSearchOpen}
                                    projectSearchQuery={projectSearchQuery}
                                    projectSearchRemoteLoading={projectSearchRemoteLoading}
                                    projectSearchResults={projectSearchResults}
                                    removeIssueType={removeIssueType}
                                    removeProjectSelection={removeProjectSelection}
                                    resetPriorityWeightsDraft={resetPriorityWeightsDraft}
                                    resolveCapacityProjectName={resolveCapacityProjectName}
                                    resolveProjectName={resolveProjectName}
                                    selectAdminSettingsTab={selectAdminSettingsTab}
                                    selectedProjectsDraft={selectedProjectsDraft}
                                    setBoardIdDraft={setBoardIdDraft}
                                    setBoardNameDraft={setBoardNameDraft}
                                    setBoardSearchIndex={setBoardSearchIndex}
                                    setBoardSearchOpen={setBoardSearchOpen}
                                    setBoardSearchQuery={setBoardSearchQuery}
                                    setCapacityFieldIdDraft={setCapacityFieldIdDraft}
                                    setCapacityFieldNameDraft={setCapacityFieldNameDraft}
                                    setCapacityFieldSearchIndex={setCapacityFieldSearchIndex}
                                    setCapacityFieldSearchOpen={setCapacityFieldSearchOpen}
                                    setCapacityFieldSearchQuery={setCapacityFieldSearchQuery}
                                    setCapacityProjectDraft={setCapacityProjectDraft}
                                    setCapacityProjectSearchIndex={setCapacityProjectSearchIndex}
                                    setCapacityProjectSearchOpen={setCapacityProjectSearchOpen}
                                    setCapacityProjectSearchQuery={setCapacityProjectSearchQuery}
                                    setDeliveryOwnerFieldIdDraft={setDeliveryOwnerFieldIdDraft}
                                    setDeliveryOwnerFieldNameDraft={setDeliveryOwnerFieldNameDraft}
                                    setDeliveryOwnerFieldSearchIndex={setDeliveryOwnerFieldSearchIndex}
                                    setDeliveryOwnerFieldSearchOpen={setDeliveryOwnerFieldSearchOpen}
                                    setDeliveryOwnerFieldSearchQuery={setDeliveryOwnerFieldSearchQuery}
                                    setIssueTypeSearchIndex={setIssueTypeSearchIndex}
                                    setIssueTypeSearchOpen={setIssueTypeSearchOpen}
                                    setIssueTypeSearchQuery={setIssueTypeSearchQuery}
                                    setMappingHoverKey={setMappingHoverKey}
                                    setParentNameFieldIdDraft={setParentNameFieldIdDraft}
                                    setParentNameFieldNameDraft={setParentNameFieldNameDraft}
                                    setParentNameFieldSearchIndex={setParentNameFieldSearchIndex}
                                    setParentNameFieldSearchOpen={setParentNameFieldSearchOpen}
                                    setParentNameFieldSearchQuery={setParentNameFieldSearchQuery}
                                    setProjectSearchIndex={setProjectSearchIndex}
                                    setProjectSearchOpen={setProjectSearchOpen}
                                    setProjectSearchQuery={setProjectSearchQuery}
                                    setShowTechnicalFieldIds={setShowTechnicalFieldIds}
                                    setSprintFieldIdDraft={setSprintFieldIdDraft}
                                    setSprintFieldNameDraft={setSprintFieldNameDraft}
                                    setSprintFieldSearchIndex={setSprintFieldSearchIndex}
                                    setSprintFieldSearchOpen={setSprintFieldSearchOpen}
                                    setSprintFieldSearchQuery={setSprintFieldSearchQuery}
                                    setStoryPointsFieldIdDraft={setStoryPointsFieldIdDraft}
                                    setStoryPointsFieldNameDraft={setStoryPointsFieldNameDraft}
                                    setStoryPointsFieldSearchIndex={setStoryPointsFieldSearchIndex}
                                    setStoryPointsFieldSearchOpen={setStoryPointsFieldSearchOpen}
                                    setStoryPointsFieldSearchQuery={setStoryPointsFieldSearchQuery}
                                    setTeamFieldIdDraft={setTeamFieldIdDraft}
                                    setTeamFieldNameDraft={setTeamFieldNameDraft}
                                    setTeamFieldSearchIndex={setTeamFieldSearchIndex}
                                    setTeamFieldSearchOpen={setTeamFieldSearchOpen}
                                    setTeamFieldSearchQuery={setTeamFieldSearchQuery}
                                    showTechnicalFieldIds={showTechnicalFieldIds}
                                    sprintFieldIdDraft={sprintFieldIdDraft}
                                    sprintFieldNameDraft={sprintFieldNameDraft}
                                    sprintFieldSearchHidden={sprintFieldSearchHidden}
                                    sprintFieldSearchIndex={sprintFieldSearchIndex}
                                    sprintFieldSearchInputRef={sprintFieldSearchInputRef}
                                    sprintFieldSearchOpen={sprintFieldSearchOpen}
                                    sprintFieldSearchQuery={sprintFieldSearchQuery}
                                    sprintFieldSearchResults={sprintFieldSearchResults}
                                    storyPointsFieldIdDraft={storyPointsFieldIdDraft}
                                    storyPointsFieldNameDraft={storyPointsFieldNameDraft}
                                    storyPointsFieldSearchHidden={storyPointsFieldSearchHidden}
                                    storyPointsFieldSearchIndex={storyPointsFieldSearchIndex}
                                    storyPointsFieldSearchInputRef={storyPointsFieldSearchInputRef}
                                    storyPointsFieldSearchOpen={storyPointsFieldSearchOpen}
                                    storyPointsFieldSearchQuery={storyPointsFieldSearchQuery}
                                    storyPointsFieldSearchResults={storyPointsFieldSearchResults}
                                    teamFieldIdDraft={teamFieldIdDraft}
                                    teamFieldNameDraft={teamFieldNameDraft}
                                    teamFieldSearchHidden={teamFieldSearchHidden}
                                    teamFieldSearchIndex={teamFieldSearchIndex}
                                    teamFieldSearchInputRef={teamFieldSearchInputRef}
                                    teamFieldSearchOpen={teamFieldSearchOpen}
                                    teamFieldSearchQuery={teamFieldSearchQuery}
                                    teamFieldSearchResults={teamFieldSearchResults}
                                    updatePriorityWeightDraft={updatePriorityWeightDraft}
                                />
                                )}
                                {groupManageTab === 'epm' && (
                                <EpmSettingsTab
                                    activeEpmRootGoalIndex={activeEpmRootGoalIndex}
                                    activeEpmSubGoalIndex={activeEpmSubGoalIndex}
                                    addCustomEpmProjectDraft={addCustomEpmProjectDraft}
                                    canLoadEpmProjects={canLoadEpmProjects}
                                    clearEpmRootGoal={clearEpmRootGoal}
                                    clearEpmSubGoal={clearEpmSubGoal}
                                    deleteEpmProjectRow={deleteEpmProjectRow}
                                    ensureEpmSettingsProjectsLoaded={ensureEpmSettingsProjectsLoaded}
                                    epmConfigDraft={epmConfigDraft}
                                    epmConfigLoading={epmConfigLoading}
                                    epmConfigSaving={epmConfigSaving}
                                    epmLabelChanging={epmLabelChanging}
                                    epmLabelMenuAnchor={epmLabelMenuAnchor}
                                    epmLabelMenuInputRef={epmLabelMenuInputRef}
                                    epmLabelShowAll={epmLabelShowAll}
                                    epmProjectPrerequisites={epmProjectPrerequisites}
                                    epmRootGoalQuery={epmRootGoalQuery}
                                    epmRootGoalsError={epmRootGoalsError}
                                    epmRootGoalsLoading={epmRootGoalsLoading}
                                    epmScopeMeta={epmScopeMeta}
                                    epmSettingsProjectRows={epmSettingsProjectRows}
                                    epmSettingsProjectSort={epmSettingsProjectSort}
                                    epmSettingsProjectView={epmSettingsProjectView}
                                    epmSettingsProjects={epmSettingsProjects}
                                    epmSettingsProjectsError={epmSettingsProjectsError}
                                    epmSettingsProjectsFetchMeta={epmSettingsProjectsFetchMeta}
                                    epmSettingsProjectsLoaded={epmSettingsProjectsLoaded}
                                    epmSettingsProjectsLoadedAt={epmSettingsProjectsLoadedAt}
                                    epmSettingsProjectsLoading={epmSettingsProjectsLoading}
                                    epmSettingsProjectsRefreshing={epmSettingsProjectsRefreshing}
                                    epmSettingsTab={epmSettingsTab}
                                    epmSubGoalQuery={epmSubGoalQuery}
                                    epmSubGoalsError={epmSubGoalsError}
                                    epmSubGoalsLoading={epmSubGoalsLoading}
                                    filteredEpmRootGoals={filteredEpmRootGoals}
                                    filteredEpmSubGoals={filteredEpmSubGoals}
                                    focusEpmScopeField={focusEpmScopeField}
                                    getEpmLabelRowKey={getEpmLabelRowKey}
                                    getEpmLabelSearchResults={getEpmLabelSearchResults}
                                    handleEpmLabelSearchKeyDown={handleEpmLabelSearchKeyDown}
                                    handleEpmRootGoalSearchKeyDown={handleEpmRootGoalSearchKeyDown}
                                    handleEpmSettingsTabKeyDown={handleEpmSettingsTabKeyDown}
                                    handleEpmSubGoalSearchKeyDown={handleEpmSubGoalSearchKeyDown}
                                    labelSearchIndex={labelSearchIndex}
                                    labelSearchLoading={labelSearchLoading}
                                    labelSearchOpen={labelSearchOpen}
                                    labelSearchQuery={labelSearchQuery}
                                    loadEpmProjectLabels={loadEpmProjectLabels}
                                    loadEpmSubGoalsForRoot={loadEpmSubGoalsForRoot}
                                    openEpmLabelMenu={openEpmLabelMenu}
                                    registerEpmLabelInput={registerEpmLabelInput}
                                    removeEpmProjectDraft={removeEpmProjectDraft}
                                    removedEpmProjectIds={removedEpmProjectIds}
                                    requestEpmLabelFocus={requestEpmLabelFocus}
                                    selectEpmProjectLabel={selectEpmProjectLabel}
                                    selectEpmRootGoal={selectEpmRootGoal}
                                    selectEpmSubGoal={selectEpmSubGoal}
                                    selectedEpmRootGoal={selectedEpmRootGoal}
                                    selectedEpmSubGoals={selectedEpmSubGoals}
                                    setEpmLabelChanging={setEpmLabelChanging}
                                    setEpmLabelMenuAnchor={setEpmLabelMenuAnchor}
                                    setEpmLabelShowAll={setEpmLabelShowAll}
                                    setEpmRootGoalIndex={setEpmRootGoalIndex}
                                    setEpmRootGoalOpen={setEpmRootGoalOpen}
                                    setEpmRootGoalQuery={setEpmRootGoalQuery}
                                    setEpmSettingsProjectView={setEpmSettingsProjectView}
                                    setEpmSettingsTab={setEpmSettingsTab}
                                    setEpmSubGoalIndex={setEpmSubGoalIndex}
                                    setEpmSubGoalOpen={setEpmSubGoalOpen}
                                    setEpmSubGoalQuery={setEpmSubGoalQuery}
                                    setLabelSearchIndex={setLabelSearchIndex}
                                    setLabelSearchOpen={setLabelSearchOpen}
                                    setLabelSearchQuery={setLabelSearchQuery}
                                    setTrackedEpmSettingsProjectSort={setTrackedEpmSettingsProjectSort}
                                    showEpmRootGoalResults={showEpmRootGoalResults}
                                    showEpmSubGoalResults={showEpmSubGoalResults}
                                    updateEpmLabelPrefixDraft={updateEpmLabelPrefixDraft}
                                    updateEpmProjectDraft={updateEpmProjectDraft}
                                    visibleEpmRootGoals={visibleEpmRootGoals}
                                    visibleEpmSubGoals={visibleEpmSubGoals}
                                />
                                )}
                                {DEPARTMENT_SETTINGS_TAB_IDS.has(groupManageTab) && (
                                <DepartmentsSettingsTab
                                    BACKEND_URL={BACKEND_URL}
                                    activeGroupDraft={activeGroupDraft}
                                    activeTeamIndex={activeTeamIndex}
                                    activeTeamQuery={activeTeamQuery}
                                    activeTeamResultsLimited={activeTeamResultsLimited}
                                    adHocEpicChipLastRef={adHocEpicChipLastRef}
                                    adHocEpicSearchIndex={adHocEpicSearchIndex}
                                    adHocEpicSearchInputRef={adHocEpicSearchInputRef}
                                    adHocEpicSearchLoading={adHocEpicSearchLoading}
                                    adHocEpicSearchOpen={adHocEpicSearchOpen}
                                    adHocEpicSearchQuery={adHocEpicSearchQuery}
                                    addGroupAdHocCapacityEpic={addGroupAdHocCapacityEpic}
                                    addGroupDraftRow={addGroupDraftRow}
                                    addGroupExcludedCapacityEpic={addGroupExcludedCapacityEpic}
                                    addGroupMissingInfoComponent={addGroupMissingInfoComponent}
                                    addTeamToGroup={addTeamToGroup}
                                    advanceFirstRunConfigurationGuide={advanceFirstRunConfigurationGuide}
                                    availableTeams={availableTeams}
                                    backFirstRunConfigurationGuide={backFirstRunConfigurationGuide}
                                    cancelFirstRunConfiguration={cancelFirstRunConfiguration}
                                    closeTeamLabelSearch={closeTeamLabelSearch}
                                    componentSearchIndex={componentSearchIndex}
                                    componentSearchLoading={componentSearchLoading}
                                    componentSearchOpen={componentSearchOpen}
                                    componentSearchQuery={componentSearchQuery}
                                    duplicateGroupDraft={duplicateGroupDraft}
                                    epicsByStatus={epicsByStatus}
                                    excludedEpicChipLastRef={excludedEpicChipLastRef}
                                    excludedEpicSearchIndex={excludedEpicSearchIndex}
                                    excludedEpicSearchInputRef={excludedEpicSearchInputRef}
                                    excludedEpicSearchLoading={excludedEpicSearchLoading}
                                    excludedEpicSearchOpen={excludedEpicSearchOpen}
                                    excludedEpicSearchQuery={excludedEpicSearchQuery}
                                    exportGroupsConfig={exportGroupsConfig}
                                    favoriteGroupDraftId={favoriteGroupDraftId}
                                    fetchAllTeamsFromJira={fetchAllTeamsFromJira}
                                    filteredAdHocEpicSearchResults={filteredAdHocEpicSearchResults}
                                    filteredComponentSearchResults={filteredComponentSearchResults}
                                    filteredExcludedEpicSearchResults={filteredExcludedEpicSearchResults}
                                    filteredGroupDrafts={filteredGroupDrafts}
                                    firstRunConfigurationActive={firstRunConfigurationActive}
                                    firstRunConfigurationGuideVisible={firstRunConfigurationGuideVisible}
                                    firstRunConfigurationSession={firstRunConfigurationSession}
                                    getLabelSearchResults={getLabelSearchResults}
                                    groupDraft={groupDraft}
                                    groupDraftError={groupDraftError}
                                    groupImportText={groupImportText}
                                    groupManageTab={groupManageTab}
                                    groupSearchQuery={groupSearchQuery}
                                    groupVisibilitySaving={groupVisibilitySaving}
                                    groupWarnings={groupWarnings}
                                    groupsError={groupsError}
                                    handleAdHocEpicSearchBlur={handleAdHocEpicSearchBlur}
                                    handleAdHocEpicSearchChange={handleAdHocEpicSearchChange}
                                    handleAdHocEpicSearchFocus={handleAdHocEpicSearchFocus}
                                    handleAdHocEpicSearchKeyDown={handleAdHocEpicSearchKeyDown}
                                    handleComponentSearchKeyDown={handleComponentSearchKeyDown}
                                    handleDepartmentSettingsTabKeyDown={handleDepartmentSettingsTabKeyDown}
                                    handleExcludedEpicSearchBlur={handleExcludedEpicSearchBlur}
                                    handleExcludedEpicSearchChange={handleExcludedEpicSearchChange}
                                    handleExcludedEpicSearchFocus={handleExcludedEpicSearchFocus}
                                    handleExcludedEpicSearchKeyDown={handleExcludedEpicSearchKeyDown}
                                    handleLabelSearchKeyDown={handleLabelSearchKeyDown}
                                    handleTeamSearchBlur={handleTeamSearchBlur}
                                    handleTeamSearchChange={handleTeamSearchChange}
                                    handleTeamSearchFocus={handleTeamSearchFocus}
                                    handleTeamSearchKeyDown={handleTeamSearchKeyDown}
                                    importGroupsConfig={importGroupsConfig}
                                    isGroupVisibleInControls={isGroupVisibleInControls}
                                    labelAddButtonRefs={labelAddButtonRefs}
                                    labelAddOpen={labelAddOpen}
                                    labelSearchIndex={labelSearchIndex}
                                    labelSearchLoading={labelSearchLoading}
                                    labelSearchOpen={labelSearchOpen}
                                    labelSearchQuery={labelSearchQuery}
                                    labelsTabEnabled={labelsTabEnabled}
                                    loadingTeams={loadingTeams}
                                    personalGroupPreferencesEnabled={personalGroupPreferencesEnabled}
                                    removeGroupAdHocCapacityEpic={removeGroupAdHocCapacityEpic}
                                    removeGroupDraft={removeGroupDraft}
                                    removeGroupExcludedCapacityEpic={removeGroupExcludedCapacityEpic}
                                    removeGroupMissingInfoComponent={removeGroupMissingInfoComponent}
                                    removeTeamFromGroup={removeTeamFromGroup}
                                    removeTeamLabelFromGroup={removeTeamLabelFromGroup}
                                    resolveTeamName={resolveTeamName}
                                    retryFirstRunConfiguration={retryFirstRunConfiguration}
                                    returnFromFirstRunConfigurationRecovery={returnFromFirstRunConfigurationRecovery}
                                    savedBoardId={savedBoardId}
                                    savedSelectedProjects={savedSelectedProjects}
                                    scheduleJiraLabelSearch={scheduleJiraLabelSearch}
                                    selectDepartmentSettingsTab={selectDepartmentSettingsTab}
                                    selectTeamLabel={selectTeamLabel}
                                    setActiveGroupDraftId={setActiveGroupDraftId}
                                    setComponentSearchOpen={setComponentSearchOpen}
                                    setComponentSearchQuery={setComponentSearchQuery}
                                    setFavoriteGroupDraft={setFavoriteGroupDraft}
                                    setGroupImportText={setGroupImportText}
                                    setGroupSearchQuery={setGroupSearchQuery}
                                    setLabelAddOpen={setLabelAddOpen}
                                    setLabelSearchIndex={setLabelSearchIndex}
                                    setLabelSearchOpen={setLabelSearchOpen}
                                    setLabelSearchQuery={setLabelSearchQuery}
                                    setShowGroupAdvanced={setShowGroupAdvanced}
                                    setShowGroupImport={setShowGroupImport}
                                    setShowGroupListMobile={setShowGroupListMobile}
                                    showGroupAdvanced={showGroupAdvanced}
                                    showGroupImport={showGroupImport}
                                    showGroupListMobile={showGroupListMobile}
                                    teamCacheLabel={teamCacheLabel}
                                    teamCatalogCanRefresh={teamCatalogCanRefresh}
                                    teamCatalogReady={teamCatalogReady}
                                    teamChipLastRef={teamChipLastRef}
                                    teamSearchFeedback={teamSearchFeedback}
                                    teamSearchInputRefs={teamSearchInputRefs}
                                    teamSearchOpen={teamSearchOpen}
                                    toggleDefaultGroupDraft={toggleDefaultGroupDraft}
                                    toggleGroupVisibleInControls={toggleGroupVisibleInControls}
                                    updateGroupDraftBoard={updateGroupDraftBoard}
                                    updateGroupDraftName={updateGroupDraftName}
                                    visibleGroupDraftIds={visibleGroupDraftIds}
                                />
                                )}
                        </SettingsModalContainer>
                    )}
                    {groupPreferences.onboardingRequired && !showGroupManage && (
                        <FirstRunConfigurationContainer
                            closeFirstRunSetupChoice={closeFirstRunSetupChoice}
                            configureFirstRunGroup={configureFirstRunGroup}
                            continueFirstRunSetupChoice={continueFirstRunSetupChoice}
                            firstRunError={firstRunError}
                            firstRunFavoriteGroupId={firstRunFavoriteGroupId}
                            firstRunSaving={firstRunSaving}
                            firstRunSetupChoice={firstRunSetupChoice}
                            groupPreferences={groupPreferences}
                            groupsConfig={groupsConfig}
                            openFirstRunSetupChoice={openFirstRunSetupChoice}
                            saveFirstRunGroupPreferences={saveFirstRunGroupPreferences}
                            selectFirstRunFavoriteGroup={selectFirstRunFavoriteGroup}
                            setFirstRunSetupChoice={setFirstRunSetupChoice}
                        />
                    )}
                    <OnboardingTour
                        run={onboarding.run}
                        completedModules={groupPreferences.completedOnboardingModules}
                        engReadiness={onboardingEngReadiness}
                        onSkip={onboarding.skip}
                        onFinish={onboarding.finish}
                        actionPending={onboarding.pending}
                        actionError={onboarding.error}
                        returnFocusRef={onboarding.sourceSurface === 'settings' ? groupManageButtonRef : null}
                        previewSession={onboardingPreviewSession}
                        onPreviewTargetChange={handleOnboardingPreviewTargetChange}
                        onRequestPreviewClose={handleOnboardingPreviewCloseRequest}
                        activeSurface={onboardingActiveSurface}
                        moduleRequest={onboarding.moduleRequest}
                        onModuleRequestConsumed={onboarding.clearModuleRequest}
                        onModuleInterrupted={onboarding.interrupt}
                    />
                    {showUpdateModal && updateNoticeVisible && (
                        <div
                            className="update-modal-backdrop"
                            role="dialog"
                            aria-modal="true"
                            onClick={() => setShowUpdateModal(false)}
                        >
                            <div className="update-modal" onClick={(event) => event.stopPropagation()}>
                                <div className="update-modal-title">New Version Available</div>
                                <div className="update-modal-body">
                                    <div>Your dashboard is behind the latest release.</div>
                                    <div>If you installed from git:</div>
                                    <pre>{`git checkout main\n\ngit pull\n\npython3 jira_server.py`}</pre>
                                    <div>Or download the latest release zip and replace this folder.</div>
                                    <div>Then refresh this page.</div>
                                </div>
                                <div className="update-modal-actions">
                                    <button className="secondary compact" onClick={() => setShowUpdateModal(false)} type="button">
                                        Close
                                    </button>
                                    <button className="compact" onClick={dismissUpdateNotice} type="button">
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                </StatusColourProvider>
            );
        }

        const rootElement = document.getElementById('root');
        if (rootElement) {
            const root = createRoot(rootElement);
            root.render(<AuthRequiredGate><App /></AuthRequiredGate>);
        }
    
