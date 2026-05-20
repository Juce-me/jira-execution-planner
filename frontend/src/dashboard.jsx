import * as React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/dashboard.css';
import { parseScenarioDate, normalizeScenarioSummary, buildScenarioTooltipPayload, applyIssueOverride, pxToDate, dateToPx, dateToISODate, createUndoStack, validateDependencies, splitAtSprintBoundaries, SCENARIO_BAR_HEIGHT, SCENARIO_BAR_GAP, SCENARIO_COLLAPSED_ROWS, SCENARIO_TEAM_LEAD_ROWS } from './scenario/scenarioUtils.js';
import ScenarioBar from './scenario/ScenarioBar.jsx';
import { buildLaneIssues } from './scenario/scenarioLaneUtils.js';
import CohortGrid from './cohort/CohortGrid.jsx';
import OpenEpicsChart from './cohort/OpenEpicsChart.jsx';
import SegmentedControl from './ui/SegmentedControl.jsx';
import ControlField from './ui/ControlField.jsx';
import IconButton from './ui/IconButton.jsx';
import LoadingRows from './ui/LoadingRows.jsx';
import EmptyState from './ui/EmptyState.jsx';
import StatusPill from './ui/StatusPill.jsx';
import JiraExportButton from './components/JiraExportButton.jsx';
import IssueCard, { IssueCardContext } from './issues/IssueCard.jsx';
import { formatPriorityShort, getIssueStatusClassName, getIssueTeamLabel } from './issues/issueViewUtils.js';
import EngView from './eng/EngView.jsx';
import EngAlertsPanel from './eng/EngAlertsPanel.jsx';
import { useEngSprintData } from './eng/useEngSprintData.js';
import { PRIORITY_ORDER, getEpicTeamInfo, getTaskTeamInfo, groupTasksByTeam } from './eng/engTaskUtils.js';
import {
    aggregateCohortSummary,
    buildCohortGridModel,
    buildCompletedEpicsBars,
    buildOpenEpicsBars,
    buildQuarterOptions,
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
    pickAutoSelectedExcludedEpics,
    summarizeEffortTypeSplitTotals
} from './stats/excludedCapacityStats.js';
import { PRIORITY_AXIS } from './stats/statsConstants.js';
import { DEFAULT_PRIORITY_WEIGHT_ROWS, buildPriorityWeightMap, clonePriorityWeightRows } from './stats/priorityWeights.js';
import { buildBurnoutChartModel } from './stats/burnoutChartUtils.js';
import {
    buildLocalStatsFromTasks,
    buildRadarPoints,
    computePriorityWeighted,
    computeRate,
    formatPercent,
    getPriorityLabel,
    getRateClass,
    resolveTeamColor,
} from './stats/statsUtils.js';
import StatsDeliverySummary from './stats/StatsDeliverySummary.jsx';
import StatsPriorityView from './stats/StatsPriorityView.jsx';
import StatsTeamsView from './stats/StatsTeamsView.jsx';
import BurnoutChart from './stats/BurnoutChart.jsx';
import ExcludedCapacityLineChart from './stats/ExcludedCapacityLineChart.jsx';
import EffortTypeSplitChart from './stats/EffortTypeSplitChart.jsx';
import { epicHasExplicitlyEmptySprintValue, epicMatchesSelectedSprint, filterExplicitBacklogEpics, issueMatchesSelectedSprint } from './backlogAlertSprintUtils.mjs';
import { getConfigSaveRefreshTarget } from './configSaveRefreshUtils.mjs';
import { getNextExclusiveDropdownState } from './controlDropdownUtils.mjs';
import { classifyFuturePlanningNeedsStories, getFuturePlanningNeedsStoriesReasonText } from './futurePlanningNeedsStories.mjs';
import { epicMatchesFuturePlanningTeamSelection, getFuturePlanningEpicTeamInfo, getFuturePlanningExpectedTeamLabel } from './futurePlanningTeamUtils.mjs';
import {
    fetchMissingPlanningInfo as requestMissingPlanningInfo,
    fetchSprints as requestSprints,
    fetchCapacity as requestCapacity,
    fetchDependencies as requestDependencies,
    fetchExcludedCapacityStatsSource as requestExcludedCapacityStatsSource,
} from './api/engApi.js';
import {
    fetchAppConfig,
    fetchVersionInfo,
    testJiraConnection,
    fetchGroupsConfig as requestGroupsConfig,
    saveGroupsConfig as requestSaveGroupsConfig,
    fetchSelectedProjects as requestSelectedProjects,
    saveSelectedProjects as requestSaveSelectedProjects,
    fetchBoardConfig as requestBoardConfig,
    saveBoardConfig as requestSaveBoardConfig,
    fetchPriorityWeightsConfig as requestPriorityWeightsConfig,
    savePriorityWeightsConfig as requestSavePriorityWeightsConfig,
    fetchCapacityConfig as requestCapacityConfig,
    saveCapacityConfig as requestSaveCapacityConfig,
    fetchFieldConfig as requestFieldConfig,
    saveFieldConfig as requestSaveFieldConfig,
    fetchIssueTypesConfig as requestIssueTypesConfig,
    saveIssueTypesConfig as requestSaveIssueTypesConfig,
    fetchAvailableIssueTypes as requestAvailableIssueTypes,
} from './api/configApi.js';
import {
    fetchEpmConfig,
    fetchEpmScope,
    fetchEpmGoals,
    fetchEpmConfigurationProjects,
} from './api/epmApi.js';
import {
    fetchJiraLabels as requestJiraLabels,
    fetchTeamCatalog as requestTeamCatalog,
    saveTeamCatalog as requestSaveTeamCatalog,
    fetchAllTeams as requestAllTeams,
    resolveTeams as requestResolveTeams,
    fetchProjects as requestJiraProjects,
    fetchBoards as requestJiraBoards,
    searchProjects as requestProjectSearch,
    searchBoards as requestBoardSearch,
    searchComponents as requestComponentSearch,
    searchEpics as requestEpicSearch,
    fetchFields as requestJiraFields,
} from './api/jiraCatalogApi.js';
import { EpmControls } from './epm/EpmControls.jsx';
import { EpmView } from './epm/EpmView.jsx';
import EpmSettings from './epm/EpmSettings.jsx';
import SettingsModal from './settings/SettingsModal.jsx';
import TeamGroupsSettings from './settings/TeamGroupsSettings.jsx';
import JiraFieldSettings from './settings/JiraFieldSettings.jsx';
import UserConnectionsSettings from './settings/UserConnectionsSettings.jsx';
import { fetchCsrfToken, fetchHomeTokenConnection } from './api/authApi.js';
import { useEpmViewData } from './epm/useEpmViewData.js';
import {
    filterEpmSettingsProjectsForView,
    flattenEpmRollupBoardsForDependencies,
    getEpmProjectDisplayName,
    getEpmProjectPrerequisites,
    getEpmSettingsProjectsCacheKey,
    hydrateEpmProjectDraft,
    isEmptyCustomEpmProjectRow,
    isEpmProjectsConfigReady,
    normalizeEpmScopeSubGoalKeys,
    shouldUseEpmSprint,
    sortEpmSettingsProjects
} from './epm/epmProjectUtils.mjs';
import { buildPlanningScopeKey, hasPlanningState, loadPlanningState, resolvePlanningTeamSelection, savePlanningState } from './planningSelectionState.mjs';
import { buildTeamSelectionScopeKey, loadTeamSelectionState, reconcileTeamSelectionState, resolveTeamSelectionHydrationState, saveTeamSelectionState } from './teamSelectionPersistence.mjs';
import { sanitizeSelectedTeamsForScope } from './teamSelectionUtils.mjs';
import {
    collectJiraExportKeysFromEpmRollupBoards,
    collectJiraExportKeysFromScenarioIssues,
    collectJiraExportKeysFromTasks,
    openJiraIssueSearch
} from './jiraExportUtils.mjs';

        const { useState, useEffect, useRef } = React;
        const EMPTY_ARRAY = Object.freeze([]);
        const EMPTY_OBJECT = Object.freeze({});
        const DEFAULT_EPM_LABEL_PREFIX = 'rnd_project_';
        const EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY = 3;
        const ADMIN_SETTINGS_TAB_IDS = new Set(['scope', 'source', 'mapping', 'capacity', 'priorityWeights']);
        const DEPARTMENT_SETTINGS_TAB_IDS = new Set(['teams', 'labels']);
        const SHARED_CONFIGURATION_TAB_IDS = new Set([...ADMIN_SETTINGS_TAB_IDS, 'epm']);
        function isActiveHomeTokenConnection(connection) {
            return Boolean(connection?.connected && connection.status === 'active' && !connection.needsReconnect);
        }

        const createEmptyEpmConfigDraft = () => ({
            version: 2,
            labelPrefix: DEFAULT_EPM_LABEL_PREFIX,
            scope: { rootGoalKey: '', subGoalKeys: [] },
            projects: {}
        });

        // Backend server URL
        const DEFAULT_BACKEND_PORT = 5050;
        const BACKEND_URL = window.BACKEND_URL ||
            (window.location.protocol.startsWith('http')
                ? `${window.location.protocol}//${window.location.hostname}:${DEFAULT_BACKEND_PORT}`
                : `http://localhost:${DEFAULT_BACKEND_PORT}`);

        function isBackendConnectionFailure(err) {
            if (!err || err.name === 'AbortError') return false;
            const message = String(err.message || err || '').toLowerCase();
            return message.includes('failed to fetch') ||
                message.includes('load failed') ||
                message.includes('networkerror') ||
                message.includes('network error') ||
                message.includes('connection refused');
        }

        function getServerConnectionErrorMessage(backendUrl) {
            return `Server is not responding at ${backendUrl}. Start the Python server, then retry.`;
        }

        // Get current quarter in format "2025Q1"
        function getCurrentQuarter() {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1; // 1-12
            const quarter = Math.ceil(month / 3);
            return `${year}Q${quarter}`;
        }

        // Cookie helper functions
        function setCookie(name, value, days = 365) {
            const expires = new Date();
            expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
            document.cookie = `${name}=${JSON.stringify(value)};expires=${expires.toUTCString()};path=/`;
        }

        function getCookie(name) {
            const nameEQ = name + "=";
            const ca = document.cookie.split(';');
            for (let i = 0; i < ca.length; i++) {
                let c = ca[i];
                while (c.charAt(0) === ' ') c = c.substring(1, c.length);
                if (c.indexOf(nameEQ) === 0) {
                    try {
                        return JSON.parse(c.substring(nameEQ.length, c.length));
                    } catch (e) {
                        return null;
                    }
                }
            }
            return null;
        }

        const UI_PREFS_KEY = 'jira_dashboard_ui_prefs_v1';

        function loadUiPrefs() {
            try {
                const raw = window.localStorage.getItem(UI_PREFS_KEY);
                if (!raw) return null;
                const prefs = JSON.parse(raw);
                if (prefs && typeof prefs === 'object') {
                    prefs.showScenario = false;
                }
                return prefs;
            } catch (e) {
                return null;
            }
        }

        function saveUiPrefs(prefs) {
	            try {
	                window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
	            } catch (e) {
	                // ignore
	            }
	        }

        function InitiativeIcon({ className = '', size = 14 }) {
            const classes = ['initiative-icon', className].filter(Boolean).join(' ');

            return (
                <span className={classes} aria-hidden="true" title="INITIATIVE">
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
            const savedPrefsRef = useRef(loadUiPrefs() || {});
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
            const [techLoaded, setTechLoaded] = useState(false);
            const [loading, setLoading] = useState(false);
            const [error, setError] = useState('');
            const [serverConnectionError, setServerConnectionError] = useState('');
            const [showKilled, setShowKilled] = useState(savedPrefsRef.current.showKilled ?? false);
            const [showDone, setShowDone] = useState(savedPrefsRef.current.showDone ?? true);
            const [showTech, setShowTech] = useState(savedPrefsRef.current.showTech ?? true);
            const [showProduct, setShowProduct] = useState(savedPrefsRef.current.showProduct ?? true);
            const savedInitialViewRef = useRef(savedPrefsRef.current.selectedView ?? 'eng');
            const restoredInitialEpmViewRef = useRef(false);
            const [selectedView, setSelectedView] = useState(savedInitialViewRef.current === 'epm' ? 'eng' : savedInitialViewRef.current);
            const [homeTokenConnection, setHomeTokenConnection] = useState({ connected: false });
            const [homeTokenConnectionLoaded, setHomeTokenConnectionLoaded] = useState(false);
            const [authMode, setAuthMode] = useState('');
            const [scenarioCurrentUserIdentity, setScenarioCurrentUserIdentity] = useState({
                userId: '',
                displayName: ''
            });
            const hasActiveHomeTokenConnection = React.useMemo(
                () => isActiveHomeTokenConnection(homeTokenConnection),
                [homeTokenConnection]
            );
            const showEpmNavigation = authMode === 'basic' || hasActiveHomeTokenConnection;
            const [sprintName, setSprintName] = useState('Sprint');
            const [statusFilter, setStatusFilter] = useState(savedPrefsRef.current.statusFilter ?? null); // null = show all, 'in-progress', 'todo-accepted', 'done', 'high-priority'
            const [selectedSprint, setSelectedSprint] = useState(savedPrefsRef.current.selectedSprint ?? null); // Sprint ID
            const [epmProjectSearch, setEpmProjectSearch] = useState('');
            const [showEpmProjectDropdown, setShowEpmProjectDropdown] = useState(false);
            const epmProjectDropdownRefs = useRef({ main: null, compact: null });
            const [showEpmSubGoalFilterDropdown, setShowEpmSubGoalFilterDropdown] = useState(false);
            const epmSubGoalFilterDropdownRefs = useRef({ main: null, compact: null });
            const [epmConfigDraft, setEpmConfigDraft] = useState(createEmptyEpmConfigDraft());
            const [epmConfigLoading, setEpmConfigLoading] = useState(false);
            const [epmConfigSaving, setEpmConfigSaving] = useState(false);
            const [epmConfigLoaded, setEpmConfigLoaded] = useState(false);
            const [epmSettingsProjects, setEpmSettingsProjects] = useState([]);
            const [epmSettingsProjectsLoading, setEpmSettingsProjectsLoading] = useState(false);
            const [epmSettingsProjectsError, setEpmSettingsProjectsError] = useState('');
            const [epmSettingsProjectsLoaded, setEpmSettingsProjectsLoaded] = useState(false);
            const [epmSettingsProjectsLoadedAt, setEpmSettingsProjectsLoadedAt] = useState('');
            const [epmSettingsProjectsFetchMeta, setEpmSettingsProjectsFetchMeta] = useState({
                cacheHit: false,
                fetchedAt: '',
                homeProjectCount: 0,
                homeProjectLimit: null,
                possiblyTruncated: false,
            });
            const [epmSettingsProjectsRefreshing, setEpmSettingsProjectsRefreshing] = useState(false);
            const [epmSettingsProjectSort, setEpmSettingsProjectSort] = useState('status');
            const [epmSettingsProjectView, setEpmSettingsProjectView] = useState('current');
            const [epmSettingsTab, setEpmSettingsTab] = useState('scope');
            const [adminSettingsTab, setAdminSettingsTab] = useState('scope');
            const [departmentSettingsTab, setDepartmentSettingsTab] = useState('teams');
            const [epmLabelShowAll, setEpmLabelShowAll] = useState({});
            const [epmLabelChanging, setEpmLabelChanging] = useState({});
            const [epmLabelMenuAnchor, setEpmLabelMenuAnchor] = useState(null);
            const epmLabelMenuInputRef = useRef(null);
            const epmConfigBaselineRef = useRef(JSON.stringify(createEmptyEpmConfigDraft()));
            const [epmScopeMeta, setEpmScopeMeta] = useState({ cloudId: '', error: '' });
            const [epmRootGoals, setEpmRootGoals] = useState([]);
            const [epmSubGoals, setEpmSubGoals] = useState([]);
            const [epmRootGoalsLoading, setEpmRootGoalsLoading] = useState(false);
            const [epmSubGoalsLoading, setEpmSubGoalsLoading] = useState(false);
            const [epmRootGoalsError, setEpmRootGoalsError] = useState('');
            const [epmSubGoalsError, setEpmSubGoalsError] = useState('');
            const [epmRootGoalQuery, setEpmRootGoalQuery] = useState('');
            const [epmSubGoalQuery, setEpmSubGoalQuery] = useState('');
            const [epmRootGoalOpen, setEpmRootGoalOpen] = useState(false);
            const [epmSubGoalOpen, setEpmSubGoalOpen] = useState(false);
            const [epmRootGoalIndex, setEpmRootGoalIndex] = useState(0);
            const [epmSubGoalIndex, setEpmSubGoalIndex] = useState(0);
            const [availableSprints, setAvailableSprints] = useState([]);
            const [sprintsLoading, setSprintsLoading] = useState(true);
            const [groupsConfig, setGroupsConfig] = useState({
                version: 1,
                groups: [],
                defaultGroupId: '',
            });
            const [teamCatalogState, setTeamCatalogState] = useState({ catalog: {}, meta: {} });
            const [groupsLoading, setGroupsLoading] = useState(true);
            const [groupsError, setGroupsError] = useState('');
            const [groupWarnings, setGroupWarnings] = useState([]);
            const [groupConfigSource, setGroupConfigSource] = useState('');
            const [activeGroupId, setActiveGroupId] = useState(savedPrefsRef.current.activeGroupId ?? null);
            const [showGroupDropdown, setShowGroupDropdown] = useState(false);
            const groupDropdownRefs = useRef({ main: null, compact: null });
            const [showGroupManage, setShowGroupManage] = useState(false);
            const [groupDraft, setGroupDraft] = useState(null);
            const [groupDraftError, setGroupDraftError] = useState('');
            const [groupImportText, setGroupImportText] = useState('');
            const [showGroupImport, setShowGroupImport] = useState(false);
            const [showGroupAdvanced, setShowGroupAdvanced] = useState(false);
            const [groupSaving, setGroupSaving] = useState(false);
            const [groupTesting, setGroupTesting] = useState(false);
            const [groupTestMessage, setGroupTestMessage] = useState('');
            const [availableTeams, setAvailableTeams] = useState([]);
            const [loadingTeams, setLoadingTeams] = useState(false);
            const [teamSearchQuery, setTeamSearchQuery] = useState({});
            const [teamSearchOpen, setTeamSearchOpen] = useState({});
            const [teamSearchIndex, setTeamSearchIndex] = useState({});
            const [teamSearchFeedback, setTeamSearchFeedback] = useState({});
            const teamSearchInputRefs = useRef({});
            const teamSearchFeedbackTimersRef = useRef({});
            const teamChipLastRef = useRef({});
            const [labelSearchQuery, setLabelSearchQuery] = useState({});
            const [labelSearchOpen, setLabelSearchOpen] = useState({});
            const [labelSearchResults, setLabelSearchResults] = useState({});
            const [labelSearchLoading, setLabelSearchLoading] = useState({});
            const [labelSearchIndex, setLabelSearchIndex] = useState({});
            const labelSearchCacheRef = useRef({});
            const labelSearchRequestIdRef = useRef({});
            const labelSearchDebounceRef = useRef({});
            const [groupSearchQuery, setGroupSearchQuery] = useState('');
            const [activeGroupDraftId, setActiveGroupDraftId] = useState(null);
            const [showGroupListMobile, setShowGroupListMobile] = useState(false);
            const [showGroupDiscardConfirm, setShowGroupDiscardConfirm] = useState(false);
            const groupDraftBaselineRef = useRef('');
            const [groupQueryTemplateEnabled, setGroupQueryTemplateEnabled] = useState(false);
            const [groupManageTab, setGroupManageTab] = useState('scope');
            const [showTechnicalFieldIds, setShowTechnicalFieldIds] = useState(false);
            const [mappingHoverKey, setMappingHoverKey] = useState(null);
            const [settingsAdminOnly, setSettingsAdminOnly] = useState(true);
            const [userCanEditSettings, setUserCanEditSettings] = useState(false);
            const [userCanEditEpmConfig, setUserCanEditEpmConfig] = useState(false);
            const [environmentConfigExists, setEnvironmentConfigExists] = useState(false);
            const canEditSharedConfiguration = !settingsAdminOnly || userCanEditSettings;
            const canEditEpmConfiguration = canEditSharedConfiguration || userCanEditEpmConfig;
            const preferredSettingsTab = canEditSharedConfiguration && !environmentConfigExists ? 'scope' : 'teams';
            const [priorityWeightsDraft, setPriorityWeightsDraft] = useState(() => clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS));
            const [priorityWeightsSource, setPriorityWeightsSource] = useState('default');
            const [effectivePriorityWeightsRows, setEffectivePriorityWeightsRows] = useState(() => clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS));
            const priorityWeightsBaselineRef = useRef(JSON.stringify(clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS)));
            const [jiraProjects, setJiraProjects] = useState([]);
            const [loadingProjects, setLoadingProjects] = useState(false);
            const [projectSearchQuery, setProjectSearchQuery] = useState('');
            const [projectSearchRemoteResults, setProjectSearchRemoteResults] = useState([]);
            const [projectSearchRemoteLoading, setProjectSearchRemoteLoading] = useState(false);
            const [projectSearchOpen, setProjectSearchOpen] = useState(false);
            const [projectSearchIndex, setProjectSearchIndex] = useState(0);
            const [selectedProjectsDraft, setSelectedProjectsDraft] = useState([]);
            const [savedSelectedProjects, setSavedSelectedProjects] = useState([]);
            const [componentSearchQuery, setComponentSearchQuery] = useState('');
            const [componentSearchResults, setComponentSearchResults] = useState([]);
            const [componentSearchOpen, setComponentSearchOpen] = useState(false);
            const [componentSearchIndex, setComponentSearchIndex] = useState(0);
            const [componentSearchLoading, setComponentSearchLoading] = useState(false);
            const [excludedEpicSearchQuery, setExcludedEpicSearchQuery] = useState('');
            const [excludedEpicSearchResults, setExcludedEpicSearchResults] = useState([]);
            const [excludedEpicSearchOpen, setExcludedEpicSearchOpen] = useState(false);
            const [excludedEpicSearchIndex, setExcludedEpicSearchIndex] = useState(0);
            const [excludedEpicSearchLoading, setExcludedEpicSearchLoading] = useState(false);
            const excludedEpicSearchInputRef = useRef(null);
            const excludedEpicChipLastRef = useRef(null);
            const [missingInfoEpics, setMissingInfoEpics] = useState([]);
            const [backlogProductEpics, setBacklogProductEpics] = useState([]);
            const [backlogTechEpics, setBacklogTechEpics] = useState([]);
            const techProjectKeys = React.useMemo(() => {
                const keys = new Set();
                for (const p of savedSelectedProjects) {
                    if (p.type === 'tech') keys.add(p.key);
                }
                // Fallback: if no config, use TECH prefix heuristic
                if (keys.size === 0) keys.add('TECH');
                return keys;
            }, [savedSelectedProjects]);
            const selectedProjectsBaselineRef = useRef('[]');
            const projectSearchInputRef = useRef(null);
            const [jiraBoards, setJiraBoards] = useState([]);
            const [loadingBoards, setLoadingBoards] = useState(false);
            const [boardSearchRemoteResults, setBoardSearchRemoteResults] = useState([]);
            const [boardSearchRemoteLoading, setBoardSearchRemoteLoading] = useState(false);
            const [boardIdDraft, setBoardIdDraft] = useState('');
            const [boardNameDraft, setBoardNameDraft] = useState('');
            const boardConfigBaselineRef = useRef('');
            const [boardSearchQuery, setBoardSearchQuery] = useState('');
            const [boardSearchOpen, setBoardSearchOpen] = useState(false);
            const [boardSearchIndex, setBoardSearchIndex] = useState(0);
            const boardSearchInputRef = useRef(null);
            const [capacityProjectDraft, setCapacityProjectDraft] = useState('');
            const [capacityFieldIdDraft, setCapacityFieldIdDraft] = useState('');
            const [capacityFieldNameDraft, setCapacityFieldNameDraft] = useState('');
            const capacityBaselineRef = useRef('');
            const [capacityProjectSearchQuery, setCapacityProjectSearchQuery] = useState('');
            const [capacityProjectSearchOpen, setCapacityProjectSearchOpen] = useState(false);
            const [capacityProjectSearchIndex, setCapacityProjectSearchIndex] = useState(0);
            const capacityProjectSearchInputRef = useRef(null);
            const [jiraFields, setJiraFields] = useState([]);
            const [loadingFields, setLoadingFields] = useState(false);
            const [capacityFieldSearchQuery, setCapacityFieldSearchQuery] = useState('');
            const [capacityFieldSearchOpen, setCapacityFieldSearchOpen] = useState(false);
            const [capacityFieldSearchIndex, setCapacityFieldSearchIndex] = useState(0);
            const capacityFieldSearchInputRef = useRef(null);
            // Sprint field picker state
            const [sprintFieldIdDraft, setSprintFieldIdDraft] = useState('');
            const [sprintFieldNameDraft, setSprintFieldNameDraft] = useState('');
            const sprintFieldBaselineRef = useRef('');
            const [sprintFieldSearchQuery, setSprintFieldSearchQuery] = useState('');
            const [sprintFieldSearchOpen, setSprintFieldSearchOpen] = useState(false);
            const [sprintFieldSearchIndex, setSprintFieldSearchIndex] = useState(0);
            const sprintFieldSearchInputRef = useRef(null);
            // Parent Name field picker state
            const [parentNameFieldIdDraft, setParentNameFieldIdDraft] = useState('');
            const [parentNameFieldNameDraft, setParentNameFieldNameDraft] = useState('');
            const parentNameFieldBaselineRef = useRef('');
            const [parentNameFieldSearchQuery, setParentNameFieldSearchQuery] = useState('');
            const [parentNameFieldSearchOpen, setParentNameFieldSearchOpen] = useState(false);
            const [parentNameFieldSearchIndex, setParentNameFieldSearchIndex] = useState(0);
            const parentNameFieldSearchInputRef = useRef(null);
            // Story Points field picker state
            const [storyPointsFieldIdDraft, setStoryPointsFieldIdDraft] = useState('');
            const [storyPointsFieldNameDraft, setStoryPointsFieldNameDraft] = useState('');
            const storyPointsFieldBaselineRef = useRef('');
            const [storyPointsFieldSearchQuery, setStoryPointsFieldSearchQuery] = useState('');
            const [storyPointsFieldSearchOpen, setStoryPointsFieldSearchOpen] = useState(false);
            const [storyPointsFieldSearchIndex, setStoryPointsFieldSearchIndex] = useState(0);
            const storyPointsFieldSearchInputRef = useRef(null);
            // Team field picker state
            const [teamFieldIdDraft, setTeamFieldIdDraft] = useState('');
            const [teamFieldNameDraft, setTeamFieldNameDraft] = useState('');
            const teamFieldBaselineRef = useRef('');
            const [teamFieldSearchQuery, setTeamFieldSearchQuery] = useState('');
            const [teamFieldSearchOpen, setTeamFieldSearchOpen] = useState(false);
            const [teamFieldSearchIndex, setTeamFieldSearchIndex] = useState(0);
            const teamFieldSearchInputRef = useRef(null);
            const [issueTypesDraft, setIssueTypesDraft] = useState(['Story']);
            const issueTypesBaselineRef = useRef(JSON.stringify(['Story']));
            const [availableIssueTypes, setAvailableIssueTypes] = useState([]);
            const [issueTypeSearchQuery, setIssueTypeSearchQuery] = useState('');
            const [issueTypeSearchOpen, setIssueTypeSearchOpen] = useState(false);
            const [issueTypeSearchIndex, setIssueTypeSearchIndex] = useState(0);
            const issueTypeSearchInputRef = useRef(null);
            const pageLoadRefreshRef = useRef(false);
            const [jiraUrl, setJiraUrl] = useState('');
            const [selectedTasks, setSelectedTasks] = useState({});
            const [showPlanning, setShowPlanning] = useState(savedPrefsRef.current.showPlanning ?? false);
            const [showStats, setShowStats] = useState(savedPrefsRef.current.showStats ?? false);
            const [showScenario, setShowScenario] = useState(savedPrefsRef.current.showScenario ?? false);
            const [showDependencies, setShowDependencies] = useState(true);
            const [searchQuery, setSearchQuery] = useState(savedPrefsRef.current.searchQuery ?? '');
            const [searchInput, setSearchInput] = useState(savedPrefsRef.current.searchQuery ?? '');
            const [searchFocused, setSearchFocused] = useState(false);
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
            const [groupByInitiative, setGroupByInitiative] = useState(false);
            const headerRef = useRef(null);
            const compactHeaderRef = useRef(null);
            const [compactHeaderOffset, setCompactHeaderOffset] = useState(0);
            const [compactStickyVisible, setCompactStickyVisible] = useState(false);
            const [planningOffset, setPlanningOffset] = useState(0);
            const [isPlanningStuck, setIsPlanningStuck] = useState(false);
            const planningPanelRef = useRef(null);
            const planningHydratedScopeRef = useRef('');
            const teamSelectionHydratedScopeRef = useRef('');
            const teamSelectionSkipPersistScopeRef = useRef('');
            const resolveStatsView = (value) => (value === 'teams' || value === 'priority' || value === 'burnout' || value === 'cohort' || value === 'excludedCapacity' || value === 'monoCrossShare') ? value : 'teams';
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
            const [cohortGroupBy, setCohortGroupBy] = useState(resolveCohortGroupBy(savedPrefsRef.current.cohortGroupBy));
            const [cohortProjectFilter, setCohortProjectFilter] = useState(savedPrefsRef.current.cohortProjectFilter || 'all');
            const [cohortAssigneeFilter, setCohortAssigneeFilter] = useState(savedPrefsRef.current.cohortAssigneeFilter || 'all');
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
                tech: true,
                product: true
            });
            const [excludedCapacityIsolatedTeam, setExcludedCapacityIsolatedTeam] = useState(null);
            const [excludedCapacityEpicDropdownOpen, setExcludedCapacityEpicDropdownOpen] = useState(false);
            const [excludedCapacityRefreshNonce, setExcludedCapacityRefreshNonce] = useState(0);
            const excludedCapacityEpicDropdownRef = useRef(null);
            const isStatsSourceOnlyStatsView = showStats && (statsView === 'excludedCapacity' || statsView === 'monoCrossShare');
            const [burnoutHoverPoint, setBurnoutHoverPoint] = useState(null);
            const [burnoutHoverTeamKey, setBurnoutHoverTeamKey] = useState(null);
            const [burnoutTaskFilter, setBurnoutTaskFilter] = useState(null);
            const burnoutCacheRef = useRef({});
            const cohortCacheRef = useRef({});
            const excludedCapacityCacheRef = useRef({});
            const excludedCapacityForceRefreshRef = useRef(false);
            const burnoutChartRef = useRef(null);
            const [showTeamDropdown, setShowTeamDropdown] = useState(false);
            const teamDropdownRefs = useRef({ main: null, compact: null });
            const [sprintSearch, setSprintSearch] = useState('');
            const [showSprintDropdown, setShowSprintDropdown] = useState(false);
            const sprintDropdownRefs = useRef({ main: null, compact: null });
            const [capacityEnabled, setCapacityEnabled] = useState(false);
            const [capacityByTeam, setCapacityByTeam] = useState({});
            const [capacityLoading, setCapacityLoading] = useState(false);
            const [scenarioLoading, setScenarioLoading] = useState(false);
            const [scenarioError, setScenarioError] = useState('');
            const [scenarioData, setScenarioData] = useState(null);
            const [scenarioLaneMode, setScenarioLaneMode] = useState(savedPrefsRef.current.scenarioLaneMode ?? 'team');
            const [scenarioShowConflictsOnly, setScenarioShowConflictsOnly] = useState(false);
            const scenarioTimelineRef = useRef(null);
            const [scenarioLayout, setScenarioLayout] = useState({ width: 0, height: 0 });
            const [scenarioCollapsedLanes, setScenarioCollapsedLanes] = useState({});
            const [scenarioCollapsedCards, setScenarioCollapsedCards] = useState({});
            const [scenarioSummaryHidden, setScenarioSummaryHidden] = useState(true);
            const [scenarioHoverKey, setScenarioHoverKey] = useState(null);
            const [scenarioFlashKey, setScenarioFlashKey] = useState(null);
            const [scenarioScrollTop, setScenarioScrollTop] = useState(0);
            const searchInputRef = useRef(null);
            const searchFocusReleaseTimeoutRef = useRef(null);
            const [scenarioScrollLeft, setScenarioScrollLeft] = useState(0);
            const [scenarioViewportHeight, setScenarioViewportHeight] = useState(0);
            const [scenarioEpicFocus, setScenarioEpicFocus] = useState(null);
            const [scenarioRangeOverride, setScenarioRangeOverride] = useState(null);
            const scenarioFocusRestoreRef = useRef(null);
            const scenarioSkipAutoCollapseRef = useRef(false);
            const scenarioTeamCollapseInitRef = useRef(false);
            const scenarioHistoryButtonRef = useRef(null);
            const scenarioHistoryPanelRef = useRef(null);
            const scenarioHistoryTitleRef = useRef(null);
            const [scenarioOverrides, setScenarioOverrides] = useState({});
            const scenarioActiveDraftIdRef = useRef('');
            const scenarioScopeKeyRef = useRef('');
            const [scenarioDraftMeta, setScenarioDraftMeta] = useState({
                activeDraft: null,
                versions: [],
                loadedVersionNumber: null,
                baseDraftRevision: null,
                savedOverrides: {},
                scopePayload: {},
                scopeKey: '',
                dirtyState: 'clean',
                pendingScopeChange: null,
                historyOpen: false,
                loadingHistory: false,
                loadingVersionNumber: null,
                loadingActiveDraft: false,
                saving: false,
                rollingBackVersionNumber: null,
                reloadingFromJira: false,
                pendingHistoryAction: null,
                pendingActiveDraftReload: false,
                pendingReloadFromJira: false,
                writebackPreviewing: false,
                writebackChecking: false,
                writebackPreview: null,
                writebackBlocked: null,
                staleDraft: null,
                conflict: null,
                message: '',
                error: ''
            });
            const [scenarioDraftEvents, setScenarioDraftEvents] = useState([]);
            const [scenarioDraftPresence, setScenarioDraftPresence] = useState([]);
            const [scenarioDraftLocks, setScenarioDraftLocks] = useState([]);
            const [scenarioDraftRealtimeStatus, setScenarioDraftRealtimeStatus] = useState({
                mode: 'idle',
                paused: false,
                message: ''
            });
            const [scenarioDraftLastEventNumber, setScenarioDraftLastEventNumber] = useState(0);
            const [scenarioEditMode, setScenarioEditMode] = useState(false);

            const scenarioUndoStackRef = useRef(createUndoStack());
            const [scenarioUndoVersion, setScenarioUndoVersion] = useState(0);
            const [scenarioDragState, setScenarioDragState] = useState(null);
            const scenarioDragStateRef = useRef(null);
            const scenarioDragFrameRef = useRef(null);
            const scenarioDragLockRefreshRef = useRef(null);
            const scenarioRealtimeCsrfRef = useRef('');
            const scenarioHistoryRefreshControllerRef = useRef(null);
            const scenarioHistoryActionControllerRef = useRef(null);
            const scenarioViewRangeRef = useRef({ start: null, end: null });
            const scenarioWasDraggedRef = useRef(false);
            const scenarioEdgeUpdatePendingRef = useRef(false);
            const scenarioEdgeFrameRef = useRef(null);
            const scenarioScrollFrameRef = useRef(null);
            const scenarioResizeFrameRef = useRef(null);
            const scenarioPendingScrollRef = useRef(null);
            let scheduleScenarioEdgeUpdate;
            const [scenarioTooltip, setScenarioTooltip] = useState({
                visible: false,
                x: 0,
                y: 0,
                summary: '',
                key: '',
                sp: null,
                note: '',
                assignee: null,
                team: null
            });
            const scenarioTooltipRef = useRef(null);
            const scenarioTooltipAnchorRef = useRef(null);
            const scenarioIssueRefMap = useRef(new Map());
            const [scenarioEdgeRender, setScenarioEdgeRender] = useState({ width: 0, height: 0, paths: [] });
            const [dependencyData, setDependencyData] = useState({});
            const [dependencyFocus, setDependencyFocus] = useState(null);
            const [dependencyHover, setDependencyHover] = useState(null);
            const [dependencyLookupCache, setDependencyLookupCache] = useState({});
            const [dependencyLookupLoading, setDependencyLookupLoading] = useState(false);
            const [excludedStatsEpics, setExcludedStatsEpics] = useState(savedPrefsRef.current.excludedStatsEpics ?? []);
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
            const epicOrderRef = useRef({});
            const epicOrderCounterRef = useRef(0);
            const epicRefMap = useRef(new Map());
            const stickyEpicFrameRef = useRef(null);
            const groupStateRef = useRef(new Map());
            const restoringGroupRef = useRef(false);
            const activeGroupRef = useRef(null);
            const sprintFetchControllersRef = useRef(new Set());
            const lastLoadedSprintRef = useRef(null);
            const sprintLoadRef = useRef({ sprintId: null, product: false, tech: false });
            const readyToCloseLoadRef = useRef('');
            const epmSettingsProjectsRequestIdRef = useRef(0);
            const epmSettingsProjectsCacheRef = useRef(new Map());
            const epmDraftIdCounterRef = useRef(0);
            const epmSubGoalsRequestIdRef = useRef(0);
            const epmSubGoalsCacheRef = useRef(new Map());
            const pendingConfigRefreshRef = useRef(0);
            const configRefreshTargetRef = useRef('none');
            const scenarioRefreshNonceRef = useRef(0);
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
            const clearServerConnectionError = React.useCallback(() => {
                setServerConnectionError('');
            }, []);
            const reportServerConnectionError = React.useCallback((err) => {
                if (!isBackendConnectionFailure(err)) return false;
                setServerConnectionError(getServerConnectionErrorMessage(BACKEND_URL));
                return true;
            }, []);
            const refreshHomeTokenConnectionStatus = React.useCallback(async () => {
                try {
                    const payload = await fetchHomeTokenConnection(BACKEND_URL);
                    const nextConnection = payload || { connected: false };
                    clearServerConnectionError();
                    setHomeTokenConnection(nextConnection);
                    return nextConnection;
                } catch (err) {
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
            const loadEpmConfig = () => fetchEpmConfig(BACKEND_URL);
            const loadEpmScopeMeta = () => fetchEpmScope(BACKEND_URL);
            const loadEpmGoals = (rootGoalKey = '') => fetchEpmGoals(BACKEND_URL, rootGoalKey);
            const loadEpmConfigurationProjects = async (draftConfig, options = {}) => {
                return fetchEpmConfigurationProjects(BACKEND_URL, draftConfig, options);
            };
            const resetEpmSettingsProjectRows = () => {
                epmSettingsProjectsRequestIdRef.current += 1;
                setEpmSettingsProjects([]);
                setEpmSettingsProjectsLoading(false);
                setEpmSettingsProjectsError('');
                setEpmSettingsProjectsLoaded(false);
                setEpmSettingsProjectsLoadedAt('');
                setEpmSettingsProjectsRefreshing(false);
            };
            const getHomeBackedEpmSettingsProjects = (projects) => {
                return Array.isArray(projects)
                    ? projects.filter(project => project?.homeProjectId !== null)
                    : [];
            };
            const renderEpmProjectSkeletonRows = () => (
                <LoadingRows
                    className="epm-project-skeleton-list"
                    rowClassName="epm-project-skeleton-row"
                    ariaLabel="Loading EPM projects"
                    rows={3}
                    columns={2}
                />
            );
            const ensureEpmSettingsProjectsLoaded = async (options = {}) => {
                const forceRefresh = Boolean(options.forceRefresh);
                const draftConfig = normalizeEpmConfigDraft(options.draftConfig || epmConfigDraft);
                const cacheKey = options.cacheKey || getEpmSettingsProjectsCacheKey(draftConfig);
                epmSettingsProjectsRequestIdRef.current += 1;
                const requestId = epmSettingsProjectsRequestIdRef.current;
                if (!cacheKey) {
                    setEpmSettingsProjectsError('');
                    setEpmSettingsProjectsLoading(false);
                    setEpmSettingsProjectsRefreshing(false);
                    setEpmSettingsProjectsLoaded(false);
                    setEpmSettingsProjectsLoadedAt('');
                    return [];
                }
                if (!forceRefresh && epmSettingsProjectsCacheRef.current.has(cacheKey)) {
                    const cachedEntry = epmSettingsProjectsCacheRef.current.get(cacheKey) || {};
                    const cachedProjects = Array.isArray(cachedEntry.projects) ? cachedEntry.projects : [];
                    const cachedLoadedAt = String(cachedEntry.loadedAt || '');
                    setEpmSettingsProjects(cachedProjects);
                    setEpmSettingsProjectsFetchMeta(cachedEntry.meta || {
                        cacheHit: true,
                        fetchedAt: '',
                        homeProjectCount: cachedProjects.length,
                        homeProjectLimit: null,
                        possiblyTruncated: false,
                    });
                    setEpmSettingsProjectsError('');
                    setEpmSettingsProjectsLoaded(true);
                    setEpmSettingsProjectsLoadedAt(cachedLoadedAt);
                    return cachedProjects;
                }

                const hasExistingRows = epmSettingsProjectsLoaded && epmSettingsProjectRows.length > 0;
                setEpmSettingsProjectsLoading(!hasExistingRows);
                setEpmSettingsProjectsRefreshing(hasExistingRows);
                setEpmSettingsProjectsError('');
                try {
                    const payload = await loadEpmConfigurationProjects(draftConfig, { forceRefresh });
                    if (epmSettingsProjectsRequestIdRef.current !== requestId) {
                        return [];
                    }
                    const nextProjects = getHomeBackedEpmSettingsProjects(payload.projects);
                    const nextMeta = {
                        cacheHit: Boolean(payload.cacheHit),
                        fetchedAt: String(payload.fetchedAt || ''),
                        homeProjectCount: Number(payload.homeProjectCount || nextProjects.filter(project => project?.homeProjectId).length || 0),
                        homeProjectLimit: payload.homeProjectLimit ?? null,
                        possiblyTruncated: Boolean(payload.possiblyTruncated),
                    };
                    const loadedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    epmSettingsProjectsCacheRef.current.set(cacheKey, { projects: nextProjects, meta: nextMeta, loadedAt });
                    setEpmSettingsProjects(nextProjects);
                    setEpmSettingsProjectsFetchMeta(nextMeta);
                    setEpmSettingsProjectsLoaded(true);
                    setEpmSettingsProjectsLoadedAt(loadedAt);
                    return nextProjects;
                } catch (err) {
                    if (epmSettingsProjectsRequestIdRef.current !== requestId) {
                        return [];
                    }
                    console.error('Failed to load EPM projects:', err);
                    setEpmSettingsProjectsError(err?.message || 'Failed to load EPM projects.');
                    return [];
                } finally {
                    if (epmSettingsProjectsRequestIdRef.current === requestId) {
                        setEpmSettingsProjectsLoading(false);
                        setEpmSettingsProjectsRefreshing(false);
                    }
                }
            };
            const updateEpmSettingsProjectRowsAfterSave = (savedConfig) => {
                const previousCacheKey = getEpmSettingsProjectsCacheKey(epmConfigDraft);
                const nextCacheKey = getEpmSettingsProjectsCacheKey(savedConfig);
                if (!nextCacheKey) return;
                const rawPreviousEntry = previousCacheKey
                    ? epmSettingsProjectsCacheRef.current.get(previousCacheKey)
                    : null;
                const previousEntry = rawPreviousEntry
                    ? {
                        ...rawPreviousEntry,
                        projects: getHomeBackedEpmSettingsProjects(rawPreviousEntry.projects),
                    }
                    : null;
                const currentEntry = epmSettingsProjects.length > 0
                    ? {
                        projects: getHomeBackedEpmSettingsProjects(epmSettingsProjects),
                        meta: epmSettingsProjectsFetchMeta,
                        loadedAt: epmSettingsProjectsLoadedAt,
                    }
                    : null;
                const nextEntry = previousEntry || currentEntry;
                if (nextEntry) {
                    epmSettingsProjectsCacheRef.current.set(nextCacheKey, nextEntry);
                }
            };
            const saveEpmConfig = async () => {
                setEpmConfigSaving(true);
                setGroupDraftError('');
                try {
                    const normalizedDraft = normalizeEpmConfigDraft(epmConfigDraft);
                    const { csrfToken } = await fetchCsrfToken(BACKEND_URL);
                    const response = await fetch(`${BACKEND_URL}/api/epm/config`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Requested-With': 'jira-execution-planner',
                            'X-CSRF-Token': csrfToken || ''
                        },
                        body: JSON.stringify(normalizedDraft)
                    });
                    if (!response.ok) {
                        throw new Error(`Failed to save EPM config: ${response.status}`);
                    }
                    const payload = await response.json();
                    const nextConfig = normalizeEpmConfigDraft(payload);
                    applySavedEpmConfig(nextConfig);
                    updateEpmSettingsProjectRowsAfterSave(nextConfig);
                    if (hasSavedEpmScopeConfig(nextConfig)) {
                        await refreshEpmProjects();
                    } else {
                        setEpmProjects([]);
                        setEpmProjectsError('');
                        setEpmSettingsProjects([]);
                        setEpmSettingsProjectsLoaded(false);
                    }
                } catch (err) {
                    const message = err?.message || 'Failed to save EPM settings.';
                    setGroupDraftError(message);
                    console.error('Failed to save EPM config:', err);
                    throw err;
                } finally {
                    setEpmConfigSaving(false);
                }
            };
            const updateEpmLabelPrefixDraft = (value) => {
                setEpmConfigDraft((prev) => ({
                    ...prev,
                    labelPrefix: value,
                }));
                setLabelSearchResults(prev => {
                    const next = { ...prev };
                    Object.keys(next).forEach((key) => {
                        if (key.startsWith(`${EPM_LABEL_SEARCH_GROUP_ID}:`)) {
                            delete next[key];
                        }
                    });
                    return next;
                });
            };
            const updateEpmProjectDraft = (projectId, field, value) => {
                setEpmConfigDraft((prev) => {
                    const prevProjects = prev.projects || {};
                    const rowSource = epmSettingsProjectRows.find(row => row.id === projectId);
                    const prevRow = prevProjects[projectId] || { id: projectId, homeProjectId: rowSource?.homeProjectId };
                    return {
                        ...prev,
                        projects: {
                            ...prevProjects,
                            [projectId]: { ...prevRow, id: projectId, [field]: value },
                        },
                    };
                });
            };
            const EPM_LABEL_SEARCH_GROUP_ID = 'epm-project';
            const getEpmLabelRowKey = (projectId) => getLabelRowKey(EPM_LABEL_SEARCH_GROUP_ID, projectId);
            const getEpmLabelSearchResults = (projectId) => {
                const key = getEpmLabelRowKey(projectId);
                const query = String(labelSearchQuery[key] || '').trim();
                const results = labelSearchResults[key] || [];
                if (!query) return results;
                const normalizedQuery = query.toLowerCase();
                return results.filter(label => String(label || '').toLowerCase().includes(normalizedQuery));
            };
            const addCustomEpmProjectDraft = () => {
                epmDraftIdCounterRef.current += 1;
                const draftId = `draft-${Date.now().toString(36)}-${epmDraftIdCounterRef.current}`;
                setEpmConfigDraft((prev) => ({
                    ...prev,
                    projects: {
                        ...(prev.projects || {}),
                        [draftId]: {
                            id: draftId,
                            homeProjectId: null,
                            name: '',
                            label: '',
                        },
                    },
                }));
            };
            const removeEpmProjectDraft = (projectId) => {
                setEpmConfigDraft((prev) => {
                    const nextProjects = { ...(prev.projects || {}) };
                    delete nextProjects[projectId];
                    return {
                        ...prev,
                        projects: nextProjects,
                    };
                });
            };
            const loadEpmProjectLabels = async (projectId, showAll = false) => {
                const key = getEpmLabelRowKey(projectId);
                const requestId = (labelSearchRequestIdRef.current[key] || 0) + 1;
                labelSearchRequestIdRef.current[key] = requestId;
                setLabelSearchLoading(prev => ({ ...prev, [key]: true }));
                try {
                    const prefix = String(epmConfigDraft.labelPrefix ?? DEFAULT_EPM_LABEL_PREFIX).trim();
                    const payload = await requestJiraLabels(BACKEND_URL, showAll || !prefix
                        ? { limit: 200 }
                        : { prefix, limit: 200 });
                    const nextResults = Array.isArray(payload.labels) ? payload.labels : [];
                    if (labelSearchRequestIdRef.current[key] === requestId) {
                        setLabelSearchResults(prev => ({ ...prev, [key]: nextResults }));
                        setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
                    }
                } catch (error) {
                    if (labelSearchRequestIdRef.current[key] === requestId) {
                        setLabelSearchResults(prev => ({ ...prev, [key]: [] }));
                        setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
                    }
                } finally {
                    if (labelSearchRequestIdRef.current[key] === requestId) {
                        setLabelSearchLoading(prev => ({ ...prev, [key]: false }));
                    }
                }
            };
            const selectEpmProjectLabel = React.useCallback((projectId, label) => {
                const key = getEpmLabelRowKey(projectId);
                updateEpmProjectDraft(projectId, 'label', label);
                setLabelSearchQuery(prev => ({ ...prev, [key]: '' }));
                setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
                setLabelSearchOpen(prev => ({ ...prev, [key]: false }));
                setEpmLabelChanging(prev => ({ ...prev, [key]: false }));
                setEpmLabelMenuAnchor(null);
                epmLabelMenuInputRef.current = null;
            }, [updateEpmProjectDraft]);
            const openEpmLabelMenu = (projectId, inputNode, showAllLabels) => {
                if (!inputNode) return;
                const rowKey = getEpmLabelRowKey(projectId);
                const rect = inputNode.getBoundingClientRect();
                epmLabelMenuInputRef.current = inputNode;
                setEpmLabelMenuAnchor({
                    projectId,
                    rowKey,
                    top: rect.bottom + 4,
                    left: rect.left,
                    width: rect.width,
                });
                setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
                void loadEpmProjectLabels(projectId, showAllLabels);
            };
            useEffect(() => {
                if (!epmLabelMenuAnchor) return;
                const reposition = () => {
                    const inputNode = epmLabelMenuInputRef.current;
                    if (!inputNode || !document.body.contains(inputNode)) {
                        setEpmLabelMenuAnchor(null);
                        epmLabelMenuInputRef.current = null;
                        return;
                    }
                    const rect = inputNode.getBoundingClientRect();
                    setEpmLabelMenuAnchor(prev => prev ? {
                        ...prev,
                        top: rect.bottom + 4,
                        left: rect.left,
                        width: rect.width,
                    } : prev);
                };
                const scrollRegion = document.querySelector('.epm-projects-scroll-region');
                window.addEventListener('resize', reposition);
                scrollRegion?.addEventListener('scroll', reposition, { passive: true });
                return () => {
                    window.removeEventListener('resize', reposition);
                    scrollRegion?.removeEventListener('scroll', reposition);
                };
            }, [epmLabelMenuAnchor?.rowKey]);
            useEffect(() => {
                if (showGroupManage && groupManageTab === 'epm' && epmSettingsTab === 'projects') return;
                setEpmLabelMenuAnchor(null);
                epmLabelMenuInputRef.current = null;
            }, [showGroupManage, groupManageTab, epmSettingsTab]);
            const handleEpmLabelSearchKeyDown = React.useCallback((projectId, event, results) => {
                const key = getEpmLabelRowKey(projectId);
                if (event.key === 'ArrowDown') {
                    if (!results.length) return;
                    event.preventDefault();
                    setLabelSearchOpen(prev => ({ ...prev, [key]: true }));
                    setLabelSearchIndex(prev => ({
                        ...prev,
                        [key]: Math.min((prev[key] || 0) + 1, results.length - 1)
                    }));
                    return;
                }
                if (event.key === 'ArrowUp') {
                    if (!results.length) return;
                    event.preventDefault();
                    setLabelSearchOpen(prev => ({ ...prev, [key]: true }));
                    setLabelSearchIndex(prev => ({
                        ...prev,
                        [key]: Math.max((prev[key] || 0) - 1, 0)
                    }));
                    return;
                }
                if (event.key === 'Enter') {
                    if (!results.length) return;
                    event.preventDefault();
                    const index = labelSearchIndex[key] || 0;
                    const label = results[index] || results[0];
                    if (label) {
                        selectEpmProjectLabel(projectId, label);
                    }
                    return;
                }
                if (event.key === 'Escape' && labelSearchOpen[key]) {
                    event.preventDefault();
                    event.stopPropagation();
                    setLabelSearchOpen(prev => ({ ...prev, [key]: false }));
                }
            }, [labelSearchIndex, labelSearchOpen, selectEpmProjectLabel]);
            const updateEpmScopeDraft = (field, value) => {
                setEpmConfigDraft((prev) => ({
                    ...prev,
                    scope: {
                        ...(prev.scope || {}),
                        [field]: value,
                    },
                }));
            };
            const clearEpmSubGoalOptions = () => {
                epmSubGoalsRequestIdRef.current += 1;
                setEpmSubGoals([]);
                setEpmSubGoalsLoading(false);
                setEpmSubGoalsError('');
                setEpmSubGoalOpen(false);
                setEpmSubGoalIndex(0);
            };
            const loadEpmSubGoalsForRoot = async (rootGoalKey, expectedSubGoalKey = '', options = {}) => {
                const normalizedRootGoalKey = String(rootGoalKey || '').trim().toUpperCase();
                const normalizedExpectedSubGoalKey = String(expectedSubGoalKey || '').trim().toUpperCase();
                const forceRefresh = Boolean(options.forceRefresh);
                epmSubGoalsRequestIdRef.current += 1;
                const requestId = epmSubGoalsRequestIdRef.current;
                if (!normalizedRootGoalKey) {
                    setEpmSubGoals([]);
                    setEpmSubGoalsLoading(false);
                    setEpmSubGoalsError('');
                    return { goals: [], hasExpectedSubGoal: !normalizedExpectedSubGoalKey, lookupFailed: false };
                }
                if (!forceRefresh && epmSubGoalsCacheRef.current.has(normalizedRootGoalKey)) {
                    const cachedGoals = epmSubGoalsCacheRef.current.get(normalizedRootGoalKey) || [];
                    const hasExpectedSubGoal = !normalizedExpectedSubGoalKey
                        || cachedGoals.some((goal) => String(goal?.key || '').trim().toUpperCase() === normalizedExpectedSubGoalKey);
                    setEpmSubGoals(cachedGoals);
                    setEpmSubGoalsLoading(false);
                    setEpmSubGoalsError('');
                    return { goals: cachedGoals, hasExpectedSubGoal, lookupFailed: false };
                }
                setEpmSubGoalsLoading(true);
                setEpmSubGoalsError('');
                try {
                    const payload = await loadEpmGoals(normalizedRootGoalKey);
                    if (epmSubGoalsRequestIdRef.current !== requestId) {
                        return { goals: [], hasExpectedSubGoal: false, lookupFailed: true };
                    }
                    const nextGoals = Array.isArray(payload.goals) ? payload.goals : [];
                    epmSubGoalsCacheRef.current.set(normalizedRootGoalKey, nextGoals);
                    const lookupError = String(payload?.error || '').trim();
                    const lookupFailed = Boolean(lookupError);
                    const hasExpectedSubGoal = lookupFailed
                        || !normalizedExpectedSubGoalKey
                        || nextGoals.some((goal) => String(goal?.key || '').trim().toUpperCase() === normalizedExpectedSubGoalKey);
                    setEpmSubGoals(nextGoals);
                    setEpmSubGoalsError(lookupError);
                    if (normalizedExpectedSubGoalKey && !lookupFailed && !hasExpectedSubGoal) {
                        setEpmConfigDraft((prev) => {
                            const prevRootGoalKey = String(prev?.scope?.rootGoalKey || '').trim().toUpperCase();
                            const prevSubGoalKeys = normalizeEpmScopeSubGoalKeys(prev?.scope);
                            if (prevRootGoalKey !== normalizedRootGoalKey || !prevSubGoalKeys.includes(normalizedExpectedSubGoalKey)) {
                                return prev;
                            }
                            return {
                                ...prev,
                                scope: {
                                    ...(prev.scope || {}),
                                    subGoalKeys: prevSubGoalKeys.filter(key => key !== normalizedExpectedSubGoalKey),
                                },
                            };
                        });
                    }
                    return { goals: nextGoals, hasExpectedSubGoal, lookupFailed };
                } catch (err) {
                    if (epmSubGoalsRequestIdRef.current !== requestId) {
                        return { goals: [], hasExpectedSubGoal: false, lookupFailed: true };
                    }
                    console.error('Failed to fetch EPM sub-goals:', err);
                    setEpmSubGoals([]);
                    setEpmSubGoalsError(err?.message || '');
                    return { goals: [], hasExpectedSubGoal: true, lookupFailed: true };
                } finally {
                    if (epmSubGoalsRequestIdRef.current === requestId) {
                        setEpmSubGoalsLoading(false);
                    }
                }
            };
            const selectEpmRootGoal = async (goal) => {
                const rootGoalKey = String(goal?.key || '').trim().toUpperCase();
                const previousRootGoalKey = String(epmConfigDraft.scope?.rootGoalKey || '').trim().toUpperCase();
                const rootChanged = previousRootGoalKey !== rootGoalKey;
                if (rootChanged) {
                    resetEpmSettingsProjectRows();
                }
                setEpmConfigDraft((prev) => ({
                    ...prev,
                    scope: {
                        ...(prev.scope || {}),
                        rootGoalKey,
                        subGoalKeys: rootChanged ? [] : normalizeEpmScopeSubGoalKeys(prev.scope),
                    },
                }));
                setEpmRootGoalQuery('');
                setEpmSubGoalQuery('');
                setEpmRootGoalOpen(false);
                setEpmRootGoalIndex(0);
                if (rootChanged) {
                    clearEpmSubGoalOptions();
                }
                if (!rootGoalKey) {
                    return;
                }
                await loadEpmSubGoalsForRoot(rootGoalKey);
            };
            const clearEpmRootGoal = () => {
                resetEpmSettingsProjectRows();
                updateEpmScopeDraft('rootGoalKey', '');
                updateEpmScopeDraft('subGoalKeys', []);
                setEpmRootGoalQuery('');
                setEpmSubGoalQuery('');
                setEpmRootGoalOpen(false);
                setEpmRootGoalIndex(0);
                clearEpmSubGoalOptions();
            };
            const clearEpmSubGoal = (subGoalKey) => {
                resetEpmSettingsProjectRows();
                const normalizedSubGoalKey = String(subGoalKey || '').trim().toUpperCase();
                setEpmConfigDraft((prev) => ({
                    ...prev,
                    scope: {
                        ...(prev.scope || {}),
                        subGoalKeys: normalizeEpmScopeSubGoalKeys(prev.scope).filter(key => key !== normalizedSubGoalKey),
                    },
                }));
                setEpmSubGoalQuery('');
                setEpmSubGoalOpen(false);
                setEpmSubGoalIndex(0);
            };
            const selectEpmSubGoal = (goal) => {
                const subGoalKey = String(goal?.key || '').trim().toUpperCase();
                if (!subGoalKey) return;
                resetEpmSettingsProjectRows();
                setEpmConfigDraft((prev) => {
                    const subGoalKeys = normalizeEpmScopeSubGoalKeys(prev.scope);
                    return {
                        ...prev,
                        scope: {
                            ...(prev.scope || {}),
                            subGoalKeys: subGoalKeys.includes(subGoalKey) ? subGoalKeys : [...subGoalKeys, subGoalKey],
                        },
                    };
                });
                setEpmSubGoalQuery('');
                setEpmSubGoalOpen(false);
                setEpmSubGoalIndex(0);
            };
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
            };

            const invalidateSprintDataForConfigSave = (refreshTarget) => {
                if (!selectedSprint) return;
                abortSprintFetches();
                if (activeGroupId) {
                    groupStateRef.current.delete(activeGroupId);
                }
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
                if (refreshTarget === 'scenario') {
                    setScenarioData(null);
                    setScenarioError('');
                }
                sprintLoadRef.current = { sprintId: selectedSprint, product: false, tech: false };
                lastLoadedSprintRef.current = null;
                readyToCloseLoadRef.current = '';
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
                // Load config and sprints on component mount
                loadConfig();
                loadGroupsConfig();
                loadSelectedProjects();
                loadPriorityWeightsConfig();
                loadSprints();
            }, []);

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

            // Auto-open settings modal on first launch (no config file exists)
            const hasAutoOpenedRef = useRef(false);
            useEffect(() => {
                if (hasAutoOpenedRef.current) return;
                if (groupsLoading) return;
                if (groupConfigSource === 'auto') {
                    hasAutoOpenedRef.current = true;
                    setShowGroupManage(true);
                }
            }, [groupsLoading, groupConfigSource]);

            useEffect(() => {
                if (!showGroupManage) return;
                const normalized = normalizeGroupsConfig(groupsConfig);
                setGroupDraft(normalized);
                groupDraftBaselineRef.current = JSON.stringify({
                    version: normalized.version || 1,
                    groups: normalized.groups || [],
                    defaultGroupId: normalized.defaultGroupId || '',
                });
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
                setShowGroupListMobile(false);
                setProjectSearchQuery('');
                setActiveGroupDraftId(resolveInitialGroupId(normalized));
                loadSelectedProjects();
                loadPriorityWeightsConfig();
                loadBoardConfig();
                loadCapacityConfig();
                loadSprintFieldConfig();
                loadParentNameFieldConfig();
                loadStoryPointsFieldConfig();
                loadTeamFieldConfig();
                loadIssueTypesConfig();
                fetchAvailableIssueTypes();
                if (!jiraProjects.length) fetchJiraProjects();
                setAvailableTeams(loadTeamsFromCurrentView());
                setLoadingTeams(false);
                loadTeamCatalog();
            }, [showGroupManage, groupsConfig]);

            useEffect(() => {
                if (!showGroupManage || groupManageTab !== 'epm') return;
                let cancelled = false;
                const loadEpmSettings = async () => {
                    const emptyEpmConfig = createEmptyEpmConfigDraft();
                    setEpmConfigLoading(true);
                    setEpmScopeMeta({ cloudId: '', error: '' });
                    setEpmRootGoals([]);
                    setEpmRootGoalsLoading(false);
                    setEpmRootGoalsError('');
                    let rootGoalKey = '';
                    let loadedConfig = null;
                    try {
                        const config = await loadEpmConfig();
                        if (!cancelled) {
                            const nextConfig = applySavedEpmConfig(config);
                            loadedConfig = nextConfig;
                            rootGoalKey = String(nextConfig.scope?.rootGoalKey || '').trim().toUpperCase();
                            setEpmRootGoalQuery('');
                            setEpmSubGoalQuery('');
                            setEpmRootGoalOpen(false);
                            setEpmSubGoalOpen(false);
                            setEpmRootGoalIndex(0);
                            setEpmSubGoalIndex(0);
                        }
                    } catch (err) {
                        console.error('Failed to load EPM config:', err);
                        if (!cancelled) {
                            applySavedEpmConfig(emptyEpmConfig);
                            setGroupDraftError('Failed to load EPM settings.');
                            setEpmConfigLoading(false);
                        }
                        return;
                    } finally {
                        if (cancelled) {
                            setEpmConfigLoading(false);
                        }
                    }
                    if (cancelled) return;
                    try {
                        const scopeMeta = await loadEpmScopeMeta();
                        if (!cancelled) {
                            setEpmScopeMeta({
                                cloudId: String(scopeMeta?.cloudId || '').trim(),
                                error: String(scopeMeta?.error || '').trim(),
                            });
                        }
                    } catch (err) {
                        console.error('Failed to load EPM scope metadata:', err);
                        if (!cancelled) {
                            setEpmScopeMeta({ cloudId: '', error: err?.message || '' });
                        }
                    }
                    if (cancelled) return;
                    setEpmRootGoalsLoading(true);
                    try {
                        const rootGoalsPayload = await loadEpmGoals();
                        if (!cancelled) {
                            setEpmRootGoals(Array.isArray(rootGoalsPayload?.goals) ? rootGoalsPayload.goals : []);
                            setEpmRootGoalsError(String(rootGoalsPayload?.error || '').trim());
                        }
                    } catch (err) {
                        console.error('Failed to load EPM root goals:', err);
                        if (!cancelled) {
                            setEpmRootGoals([]);
                            setEpmRootGoalsError(err?.message || '');
                        }
                    } finally {
                        if (!cancelled) {
                            setEpmRootGoalsLoading(false);
                        }
                    }
                    if (!cancelled && rootGoalKey) {
                        await loadEpmSubGoalsForRoot(rootGoalKey);
                    }
                    if (!cancelled) {
                        setEpmConfigLoading(false);
                    }
                };
                loadEpmSettings();
                return () => {
                    cancelled = true;
                    setEpmConfigLoading(false);
                };
            }, [showGroupManage, groupManageTab]);

            useEffect(() => {
                if (!showGroupManage) return;
                const groups = groupDraft?.groups || [];
                if (!groups.length) {
                    setActiveGroupDraftId(null);
                    return;
                }
                if (!activeGroupDraftId || !groups.some(group => group.id === activeGroupDraftId)) {
                    setActiveGroupDraftId(groups[0].id);
                }
            }, [showGroupManage, groupDraft, activeGroupDraftId]);

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
                    statusFilter,
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
                statusFilter,
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


            const normalizeGroupsConfig = (config) => {
                const rawGroups = Array.isArray(config?.groups) ? config.groups : [];
                const groups = rawGroups
                    .map(group => ({
                        id: String(group?.id || '').trim(),
                        name: String(group?.name || '').trim(),
                        teamIds: Array.isArray(group?.teamIds)
                            ? group.teamIds.map(id => String(id || '').trim()).filter(Boolean)
                            : [],
                        missingInfoComponents: Array.isArray(group?.missingInfoComponents)
                            ? group.missingInfoComponents.map(c => String(c || '').trim()).filter(Boolean)
                            : (group?.missingInfoComponent ? [String(group.missingInfoComponent).trim()] : []),
                        excludedCapacityEpics: Array.isArray(group?.excludedCapacityEpics)
                            ? group.excludedCapacityEpics.map(key => String(key || '').trim().toUpperCase()).filter(Boolean)
                            : [],
                        teamLabels: Object.fromEntries(
                            Object.entries(group?.teamLabels || {})
                                .map(([teamId, label]) => [String(teamId || '').trim(), String(label || '').trim()])
                                .filter(([teamId, label]) => teamId && label)
                        )
                    }))
                    .filter(group => group.id && group.name);
                return {
                    version: Number(config?.version) || 1,
                    groups,
                    defaultGroupId: String(config?.defaultGroupId || '').trim(),
                };
            };
            const normalizeEpmConfigDraft = (config) => {
                const sourceProjects = config?.projects && typeof config.projects === 'object' ? config.projects : {};
                const projects = {};
                Object.entries(sourceProjects).forEach(([projectId, row]) => {
                    if (!row || typeof row !== 'object') return;
                    const id = String(row.id || projectId || '').trim();
                    if (!id) return;
                    const normalizedRow = {
                        id,
                        name: String(row?.name ?? ''),
                        label: String(row?.label ?? ''),
                    };
                    if (row.homeProjectId === null) {
                        normalizedRow.homeProjectId = null;
                    } else if (row.homeProjectId !== undefined) {
                        normalizedRow.homeProjectId = String(row.homeProjectId || '').trim();
                    }
                    if (isEmptyCustomEpmProjectRow(normalizedRow)) return;
                    projects[id] = normalizedRow;
                });
                return {
                    version: 2,
                    labelPrefix: String(config?.labelPrefix ?? DEFAULT_EPM_LABEL_PREFIX).trim(),
                    scope: {
                        rootGoalKey: String(config?.scope?.rootGoalKey || '').trim().toUpperCase(),
                        subGoalKeys: normalizeEpmScopeSubGoalKeys(config?.scope),
                    },
                    issueTypes: config?.issueTypes && typeof config.issueTypes === 'object' ? config.issueTypes : undefined,
                    projects,
                };
            };
            const applySavedEpmConfig = (config) => {
                const nextConfig = normalizeEpmConfigDraft(config);
                setEpmConfigDraft(nextConfig);
                epmConfigBaselineRef.current = JSON.stringify(nextConfig);
                setEpmConfigLoaded(true);
                return nextConfig;
            };
            const hasSavedEpmScopeConfig = (config) => {
                return Boolean(config?.scope?.rootGoalKey && normalizeEpmScopeSubGoalKeys(config?.scope).length > 0);
            };
            const filteredEpmRootGoals = React.useMemo(() => {
                const query = String(epmRootGoalQuery || '').trim().toLowerCase();
                if (!query) return epmRootGoals;
                return epmRootGoals.filter((goal) => {
                    const name = String(goal?.name || '').toLowerCase();
                    const key = String(goal?.key || '').toLowerCase();
                    return name.includes(query) || key.includes(query);
                });
            }, [epmRootGoals, epmRootGoalQuery]);
            const filteredEpmSubGoals = React.useMemo(() => {
                const query = String(epmSubGoalQuery || '').trim().toLowerCase();
                if (!query) return epmSubGoals;
                return epmSubGoals.filter((goal) => {
                    const name = String(goal?.name || '').toLowerCase();
                    const key = String(goal?.key || '').toLowerCase();
                    return name.includes(query) || key.includes(query);
                });
            }, [epmSubGoals, epmSubGoalQuery]);
            const selectedEpmRootGoal = React.useMemo(() => {
                const key = String(epmConfigDraft.scope?.rootGoalKey || '').trim().toUpperCase();
                if (!key) return null;
                return epmRootGoals.find((goal) => String(goal?.key || '').trim().toUpperCase() === key) || { key, name: key };
            }, [epmConfigDraft.scope?.rootGoalKey, epmRootGoals]);
            const selectedEpmSubGoals = React.useMemo(() => {
                const keys = normalizeEpmScopeSubGoalKeys(epmConfigDraft.scope);
                if (!keys.length) return [];
                return keys.map((key) => (
                    epmSubGoals.find((goal) => String(goal?.key || '').trim().toUpperCase() === key) || { key, name: key }
                ));
            }, [epmConfigDraft.scope?.subGoalKeys, epmSubGoals]);
            const visibleEpmRootGoals = filteredEpmRootGoals.slice(0, 10);
            const selectedEpmSubGoalKeySet = React.useMemo(
                () => new Set(normalizeEpmScopeSubGoalKeys(epmConfigDraft.scope)),
                [epmConfigDraft.scope?.subGoalKeys]
            );
            const visibleEpmSubGoals = filteredEpmSubGoals
                .filter((goal) => !selectedEpmSubGoalKeySet.has(String(goal?.key || '').trim().toUpperCase()))
                .slice(0, 10);
            const activeEpmRootGoalIndex = Math.min(epmRootGoalIndex, Math.max(visibleEpmRootGoals.length - 1, 0));
            const activeEpmSubGoalIndex = Math.min(epmSubGoalIndex, Math.max(visibleEpmSubGoals.length - 1, 0));
            const showEpmRootGoalResults = epmRootGoalOpen && (epmRootGoalsLoading || Boolean(epmRootGoalsError) || Boolean(epmRootGoalQuery.trim()) || visibleEpmRootGoals.length > 0 || (!epmRootGoalsLoading && !epmRootGoalsError && epmRootGoals.length === 0));
            const showEpmSubGoalResults = epmSubGoalOpen && Boolean(epmConfigDraft.scope?.rootGoalKey) && (epmSubGoalsLoading || Boolean(epmSubGoalsError) || Boolean(epmSubGoalQuery.trim()) || visibleEpmSubGoals.length > 0 || (!epmSubGoalsLoading && !epmSubGoalsError && epmSubGoals.length === 0));
            const handleEpmRootGoalSearchKeyDown = (event) => {
                if (event.key === 'ArrowDown') {
                    if (!visibleEpmRootGoals.length) return;
                    event.preventDefault();
                    setEpmRootGoalOpen(true);
                    setEpmRootGoalIndex((prev) => Math.min(prev + 1, visibleEpmRootGoals.length - 1));
                    return;
                }
                if (event.key === 'ArrowUp') {
                    if (!visibleEpmRootGoals.length) return;
                    event.preventDefault();
                    setEpmRootGoalOpen(true);
                    setEpmRootGoalIndex((prev) => Math.max(prev - 1, 0));
                    return;
                }
                if (event.key === 'Enter') {
                    if (!visibleEpmRootGoals.length) return;
                    event.preventDefault();
                    const goal = visibleEpmRootGoals[activeEpmRootGoalIndex] || visibleEpmRootGoals[0];
                    if (goal) {
                        void selectEpmRootGoal(goal);
                    }
                    return;
                }
                if (event.key === 'Escape' && epmRootGoalOpen) {
                    event.preventDefault();
                    event.stopPropagation();
                    setEpmRootGoalOpen(false);
                }
            };
            const handleEpmSubGoalSearchKeyDown = (event) => {
                if (event.key === 'ArrowDown') {
                    if (!visibleEpmSubGoals.length) return;
                    event.preventDefault();
                    setEpmSubGoalOpen(true);
                    setEpmSubGoalIndex((prev) => Math.min(prev + 1, visibleEpmSubGoals.length - 1));
                    return;
                }
                if (event.key === 'ArrowUp') {
                    if (!visibleEpmSubGoals.length) return;
                    event.preventDefault();
                    setEpmSubGoalOpen(true);
                    setEpmSubGoalIndex((prev) => Math.max(prev - 1, 0));
                    return;
                }
                if (event.key === 'Enter') {
                    if (!visibleEpmSubGoals.length) return;
                    event.preventDefault();
                    const goal = visibleEpmSubGoals[activeEpmSubGoalIndex] || visibleEpmSubGoals[0];
                    if (goal) {
                        selectEpmSubGoal(goal);
                    }
                    return;
                }
                if (event.key === 'Escape' && epmSubGoalOpen) {
                    event.preventDefault();
                    event.stopPropagation();
                    setEpmSubGoalOpen(false);
                }
            };

            const resolveInitialGroupId = (config) => {
                if (!config?.groups?.length) return null;
                if (config.defaultGroupId && config.groups.some(group => group.id === config.defaultGroupId)) {
                    return config.defaultGroupId;
                }
                const defaultGroup = config.groups.find(group => group.name.toLowerCase() === 'default');
                if (defaultGroup) return defaultGroup.id;
                return config.groups[0].id;
            };

            const loadGroupsConfig = async () => {
                setGroupsLoading(true);
                setGroupsError('');
                try {
                    const response = await requestGroupsConfig(BACKEND_URL);
                    if (!response.ok) {
                        throw new Error(`Groups config error ${response.status}`);
                    }
                    const payload = await response.json();
                    const normalized = normalizeGroupsConfig(payload);
                    clearServerConnectionError();
                    setGroupsConfig(normalized);
                    setGroupWarnings(payload.warnings || []);
                    setGroupConfigSource(payload.source || '');
                    setActiveGroupId(prev => {
                        const preferred = savedPrefsRef.current.activeGroupId;
                        if (preferred && normalized.groups.some(group => group.id === preferred)) {
                            return preferred;
                        }
                        if (prev && normalized.groups.some(group => group.id === prev)) {
                            return prev;
                        }
                        return resolveInitialGroupId(normalized);
                    });
                } catch (err) {
                    if (reportServerConnectionError(err)) {
                        setGroupsError('');
                    } else {
                        setGroupsError(err.message || 'Failed to load groups config.');
                    }
                } finally {
                    setGroupsLoading(false);
                }
            };

            const buildGroupId = (name, existingIds) => {
                const base = String(name || 'group')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '') || 'group';
                let candidate = base;
                let index = 1;
                while (existingIds.has(candidate)) {
                    candidate = `${base}-${index}`;
                    index += 1;
                }
                return candidate;
            };

            const parseTeamIdList = (raw) => {
                return String(raw || '')
                    .split(',')
                    .map(value => value.trim())
                    .filter(Boolean);
            };

            const buildTeamCatalogList = (catalog) => {
                if (!catalog || typeof catalog !== 'object') return [];
                return Object.values(catalog)
                    .filter(entry => entry && entry.id && entry.name)
                    .sort((a, b) => a.name.localeCompare(b.name));
            };

            const mergeTeamCatalog = (catalog, teams) => {
                const next = { ...(catalog || {}) };
                (teams || []).forEach(team => {
                    if (!team?.id || !team?.name) return;
                    next[String(team.id)] = { id: String(team.id), name: String(team.name) };
                });
                return next;
            };

            const loadTeamCatalog = async () => {
                try {
                    const response = await requestTeamCatalog(BACKEND_URL);
                    if (!response.ok) return;
                    const data = await response.json();
                    setTeamCatalogState({
                        catalog: data.catalog || {},
                        meta: data.meta || {}
                    });
                    const catalogTeams = buildTeamCatalogList(data.catalog || {});
                    if (catalogTeams.length) {
                        setAvailableTeams(catalogTeams);
                    }
                } catch (err) {
                    console.warn('Failed to load team catalog:', err);
                }
            };

            const saveTeamCatalog = async (catalog, meta, merge = false) => {
                try {
                    const response = await requestSaveTeamCatalog(BACKEND_URL, { catalog, meta, merge });
                    if (!response.ok) return;
                    const data = await response.json();
                    setTeamCatalogState({
                        catalog: data.catalog || {},
                        meta: data.meta || {}
                    });
                    return data;
                } catch (err) {
                    console.warn('Failed to save team catalog:', err);
                }
            };

            const handleGroupDraftChange = (updater) => {
                setGroupDraft(prev => {
                    if (!prev) return prev;
                    return updater(prev);
                });
            };

            const loadTeamsFromCurrentView = () => {
                // Use teams from already-loaded tasks (same as teams dropdown)
                const teams = teamOptions
                    .filter(team => team.id !== 'all')
                    .map(team => ({ id: team.id, name: team.name }));
                return teams;
            };

            const fetchAllTeamsFromJira = async () => {
                setLoadingTeams(true);
                setGroupDraftError('');

                try {
                    const response = await requestAllTeams(BACKEND_URL, { sprint: selectedSprint });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`HTTP ${response.status}: ${errorText}`);
                    }

                    const data = await response.json();
                    const fetchedTeams = data.teams || [];

                    if (fetchedTeams.length === 0) {
                        setGroupDraftError('No teams found in Jira for this sprint.');
                        setLoadingTeams(false);
                        return;
                    }

                    // Merge with existing teams, avoiding duplicates
                    setAvailableTeams(prevTeams => {
                        const existingIds = new Set(prevTeams.map(t => t.id));
                        const newTeams = fetchedTeams.filter(t => !existingIds.has(t.id));
                        const merged = [...prevTeams, ...newTeams].sort((a, b) => a.name.localeCompare(b.name));
                        console.log(`Loaded ${fetchedTeams.length} teams from Jira (${newTeams.length} new)`);
                        return merged;
                    });
                    const mergedCatalog = mergeTeamCatalog(teamCatalogState.catalog, fetchedTeams);
                    saveTeamCatalog(mergedCatalog, {
                        updatedAt: new Date().toISOString(),
                        sprintId: String(selectedSprint || ''),
                        sprintName: selectedSprintInfo?.name ? String(selectedSprintInfo.name) : '',
                        source: 'sprint'
                    });
                } catch (err) {
                    console.error('Error fetching teams from Jira:', err);
                    setGroupDraftError(`Failed to fetch teams: ${err.message}`);
                } finally {
                    setLoadingTeams(false);
                }
            };

            const resolveMissingTeamNames = async (teamIds) => {
                if (!teamIds.length) return;
                try {
                    const response = await requestResolveTeams(BACKEND_URL, teamIds);
                    if (!response.ok) return;
                    const data = await response.json();
                    const resolvedTeams = data.teams || [];
                    if (!resolvedTeams.length) return;
                    setAvailableTeams(prevTeams => {
                        const existingIds = new Set(prevTeams.map(t => t.id));
                        const newTeams = resolvedTeams.filter(t => !existingIds.has(t.id));
                        const merged = [...prevTeams, ...newTeams].sort((a, b) => a.name.localeCompare(b.name));
                        return merged;
                    });
                    const mergedCatalog = mergeTeamCatalog(teamCatalogState.catalog, resolvedTeams);
                    saveTeamCatalog(mergedCatalog, {
                        ...teamCatalogState.meta,
                        resolvedAt: new Date().toISOString()
                    }, false);
                } catch (err) {
                    console.warn('Failed to resolve team names:', err);
                }
            };

            const openGroupManage = () => {
                setGroupManageTab(preferredSettingsTab);
                setShowGroupManage(true);
            };

            const closeGroupManage = () => {
                setShowGroupManage(false);
                setGroupDraftError('');
                setGroupImportText('');
                setShowGroupImport(false);
                setShowGroupAdvanced(false);
                setShowGroupDiscardConfirm(false);
                setShowGroupListMobile(false);
                setGroupManageTab(preferredSettingsTab);
                setProjectSearchQuery('');
                setProjectSearchOpen(false);
                setProjectSearchIndex(0);
                setBoardSearchQuery('');
                setBoardSearchOpen(false);
                setBoardSearchIndex(0);
                setComponentSearchQuery('');
                setComponentSearchOpen(false);
                setComponentSearchIndex(0);
                setExcludedEpicSearchQuery('');
                setExcludedEpicSearchOpen(false);
                setExcludedEpicSearchIndex(0);
                setGroupTesting(false);
                setGroupTestMessage('');
                setCapacityProjectSearchQuery('');
                setCapacityProjectSearchOpen(false);
                setCapacityFieldSearchQuery('');
                setCapacityFieldSearchOpen(false);
            };

            const groupDraftSignature = React.useMemo(() => {
                if (!groupDraft) return '';
                return JSON.stringify({
                    version: groupDraft.version || 1,
                    groups: groupDraft.groups || [],
                    defaultGroupId: groupDraft.defaultGroupId || '',
                });
            }, [groupDraft]);

            const isProjectsDraftDirty = React.useMemo(() => {
                return JSON.stringify(selectedProjectsDraft) !== selectedProjectsBaselineRef.current;
            }, [selectedProjectsDraft]);

            const isPriorityWeightsDirty = React.useMemo(() => {
                return JSON.stringify(priorityWeightsDraft) !== priorityWeightsBaselineRef.current;
            }, [priorityWeightsDraft]);

            const isBoardConfigDirty = React.useMemo(() => {
                return JSON.stringify({ boardId: boardIdDraft, boardName: boardNameDraft }) !== boardConfigBaselineRef.current;
            }, [boardIdDraft, boardNameDraft]);

            const isCapacityDraftDirty = React.useMemo(() => {
                return JSON.stringify({ project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft }) !== capacityBaselineRef.current;
            }, [capacityProjectDraft, capacityFieldIdDraft, capacityFieldNameDraft]);

            const isIssueTypesDraftDirty = React.useMemo(() => {
                return JSON.stringify(issueTypesDraft) !== issueTypesBaselineRef.current;
            }, [issueTypesDraft]);

            const isSprintFieldDirty = React.useMemo(() => {
                return JSON.stringify({ fieldId: sprintFieldIdDraft, fieldName: sprintFieldNameDraft }) !== sprintFieldBaselineRef.current;
            }, [sprintFieldIdDraft, sprintFieldNameDraft]);

            const isParentNameFieldDirty = React.useMemo(() => {
                return JSON.stringify({ fieldId: parentNameFieldIdDraft, fieldName: parentNameFieldNameDraft }) !== parentNameFieldBaselineRef.current;
            }, [parentNameFieldIdDraft, parentNameFieldNameDraft]);

            const isStoryPointsFieldDirty = React.useMemo(() => {
                return JSON.stringify({ fieldId: storyPointsFieldIdDraft, fieldName: storyPointsFieldNameDraft }) !== storyPointsFieldBaselineRef.current;
            }, [storyPointsFieldIdDraft, storyPointsFieldNameDraft]);

            const isTeamFieldDirty = React.useMemo(() => {
                return JSON.stringify({ fieldId: teamFieldIdDraft, fieldName: teamFieldNameDraft }) !== teamFieldBaselineRef.current;
            }, [teamFieldIdDraft, teamFieldNameDraft]);

            const isEpmConfigDirty = React.useMemo(() => {
                return JSON.stringify(epmConfigDraft) !== epmConfigBaselineRef.current;
            }, [epmConfigDraft]);
            const hasSavedEpmScope = React.useMemo(() => {
                try {
                    const savedConfig = JSON.parse(epmConfigBaselineRef.current || '{}');
                    return hasSavedEpmScopeConfig(savedConfig);
                } catch (err) {
                    return false;
                }
            }, [epmConfigDraft]);
            const savedEpmSubGoalKeys = React.useMemo(
                () => normalizeEpmScopeSubGoalKeys(epmConfigDraft.scope),
                [epmConfigDraft.scope?.subGoalKeys]
            );
            const savedEpmRootGoalKey = React.useMemo(
                () => String(epmConfigDraft.scope?.rootGoalKey || '').trim().toUpperCase(),
                [epmConfigDraft.scope?.rootGoalKey]
            );
            useEffect(() => {
                if (!showEpmNavigation || selectedView !== 'epm' || !epmConfigLoaded || savedEpmSubGoalKeys.length < 1 || !savedEpmRootGoalKey) return;
                void loadEpmSubGoalsForRoot(savedEpmRootGoalKey);
            }, [showEpmNavigation, selectedView, epmConfigLoaded, savedEpmRootGoalKey, savedEpmSubGoalKeys]);
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
                if (epmTab === 'archived') {
                    setEpmCollapsedProjectIds((prev) => {
                        const next = new Set(prev);
                        epmVisibleProjectKeys.forEach((key) => next.add(key));
                        return next;
                    });
                    return;
                }
                setEpmCollapsedProjectIds(new Set());
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
            const hasDraftEpmScope = React.useMemo(() => {
                return hasSavedEpmScopeConfig(epmConfigDraft);
            }, [epmConfigDraft]);
            const epmProjectPrerequisites = React.useMemo(() => getEpmProjectPrerequisites(epmConfigDraft), [epmConfigDraft]);
            const canLoadEpmProjects = epmProjectPrerequisites.length === 0;
            const epmSettingsProjectsCacheKey = React.useMemo(() => getEpmSettingsProjectsCacheKey(epmConfigDraft), [epmConfigDraft]);

            useEffect(() => {
                if (epmSettingsProjectsCacheKey && epmSettingsProjectsCacheRef.current.has(epmSettingsProjectsCacheKey)) return;
                setEpmSettingsProjectsLoaded(false);
                setEpmSettingsProjectsLoadedAt('');
                setEpmSettingsProjectsFetchMeta({
                    cacheHit: false,
                    fetchedAt: '',
                    homeProjectCount: 0,
                    homeProjectLimit: null,
                    possiblyTruncated: false,
                });
            }, [epmSettingsProjectsCacheKey]);

            useEffect(() => {
                if (!showGroupManage || groupManageTab !== 'epm' || epmSettingsTab !== 'projects') return;
                if (!canLoadEpmProjects || !epmSettingsProjectsCacheKey) return;
                const draftSnapshot = normalizeEpmConfigDraft(epmConfigDraft);
                const cacheKeySnapshot = getEpmSettingsProjectsCacheKey(draftSnapshot);
                if (!cacheKeySnapshot || cacheKeySnapshot !== epmSettingsProjectsCacheKey) return;
                void ensureEpmSettingsProjectsLoaded({
                    draftConfig: draftSnapshot,
                    cacheKey: cacheKeySnapshot,
                }).catch(() => {});
            }, [showGroupManage, groupManageTab, epmSettingsTab, canLoadEpmProjects, epmSettingsProjectsCacheKey]);

            const epmSettingsProjectRows = React.useMemo(() => {
                const configuredProjects = epmConfigDraft.projects || {};
                const rows = [];
                const seen = new Set();
                (epmSettingsProjects || []).forEach((project) => {
                    const projectId = String(project?.id || project?.homeProjectId || '').trim();
                    if (!projectId) return;
                    const homeProjectId = String(project?.homeProjectId || projectId).trim();
                    const configuredRow = configuredProjects[projectId] || configuredProjects[homeProjectId] || {};
                    rows.push(hydrateEpmProjectDraft({
                        id: projectId,
                        homeProjectId,
                        homeName: String(project?.name || ''),
                        homeUrl: project?.homeUrl || project?.url || '',
                        stateLabel: project?.stateLabel || '',
                        stateValue: project?.stateValue || '',
                        latestUpdateDate: project?.latestUpdateDate || '',
                        latestUpdateSnippet: project?.latestUpdateSnippet || '',
                        name: String(configuredRow?.name ?? ''),
                        label: String(configuredRow?.label ?? ''),
                        missingFromHomeFetch: Boolean(project?.missingFromHomeFetch),
                    }, project));
                    seen.add(projectId);
                    seen.add(homeProjectId);
                });
                Object.entries(configuredProjects).forEach(([projectId, row]) => {
                    if (!row || typeof row !== 'object') return;
                    const id = String(row.id || projectId || '').trim();
                    if (!id || seen.has(id)) return;
                    const homeProjectId = row.homeProjectId === null ? null : String(row.homeProjectId || '').trim();
                    if (homeProjectId && seen.has(homeProjectId)) return;
                    rows.push(hydrateEpmProjectDraft({
                        id,
                        homeProjectId,
                        homeName: '',
                        homeUrl: '',
                        stateLabel: '',
                        stateValue: '',
                        latestUpdateDate: '',
                        latestUpdateSnippet: '',
                        name: String(row?.name ?? ''),
                        label: String(row?.label ?? ''),
                    }, null));
                });
                return sortEpmSettingsProjects(filterEpmSettingsProjectsForView(rows, epmSettingsProjectView), epmSettingsProjectSort);
            }, [epmConfigDraft, epmSettingsProjectSort, epmSettingsProjectView, epmSettingsProjects]);

            const isSharedConfigurationDraftDirty = React.useMemo(() => {
                if (isProjectsDraftDirty) return true;
                if (isPriorityWeightsDirty) return true;
                if (isBoardConfigDirty) return true;
                if (isCapacityDraftDirty) return true;
                if (isIssueTypesDraftDirty) return true;
                if (isSprintFieldDirty) return true;
                if (isParentNameFieldDirty) return true;
                if (isStoryPointsFieldDirty) return true;
                if (isTeamFieldDirty) return true;
                return false;
            }, [isProjectsDraftDirty, isPriorityWeightsDirty, isBoardConfigDirty, isCapacityDraftDirty, isIssueTypesDraftDirty, isSprintFieldDirty, isParentNameFieldDirty, isStoryPointsFieldDirty, isTeamFieldDirty]);
            const isGroupDraftDirty = React.useMemo(() => {
                if (canEditSharedConfiguration && isSharedConfigurationDraftDirty) return true;
                if (canEditEpmConfiguration && isEpmConfigDirty) return true;
                if (!groupDraft) return false;
                return groupDraftSignature !== groupDraftBaselineRef.current;
            }, [groupDraftSignature, groupDraft, canEditSharedConfiguration, canEditEpmConfiguration, isSharedConfigurationDraftDirty, isEpmConfigDirty]);
            const unsavedSectionsCount = React.useMemo(() => {
                return [
                    canEditSharedConfiguration && isProjectsDraftDirty,
                    canEditSharedConfiguration && isPriorityWeightsDirty,
                    canEditSharedConfiguration && isBoardConfigDirty,
                    canEditSharedConfiguration && isCapacityDraftDirty,
                    canEditSharedConfiguration && isIssueTypesDraftDirty,
                    canEditSharedConfiguration && isSprintFieldDirty,
                    canEditSharedConfiguration && isParentNameFieldDirty,
                    canEditSharedConfiguration && isStoryPointsFieldDirty,
                    canEditSharedConfiguration && isTeamFieldDirty,
                    canEditEpmConfiguration && isEpmConfigDirty,
                    Boolean(groupDraft && groupDraftSignature !== groupDraftBaselineRef.current)
                ].filter(Boolean).length;
            }, [canEditSharedConfiguration, canEditEpmConfiguration, isProjectsDraftDirty, isPriorityWeightsDirty, isBoardConfigDirty, isCapacityDraftDirty, isIssueTypesDraftDirty, isSprintFieldDirty, isParentNameFieldDirty, isStoryPointsFieldDirty, isTeamFieldDirty, isEpmConfigDirty, groupDraft, groupDraftSignature]);
            const priorityWeightsValidationError = React.useMemo(() => {
                for (const row of (priorityWeightsDraft || [])) {
                    const label = String(row?.priority || '').trim() || 'Priority';
                    const numeric = Number(row?.weight);
                    if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
                        return `Priority weight must be numeric for ${label}.`;
                    }
                    if (numeric < 0) {
                        return `Priority weight must be non-negative for ${label}.`;
                    }
                }
                return '';
            }, [priorityWeightsDraft]);
            const priorityWeightsSum = React.useMemo(() => {
                return (priorityWeightsDraft || []).reduce((acc, row) => {
                    const numeric = Number(row?.weight);
                    if (Number.isNaN(numeric) || !Number.isFinite(numeric)) return acc;
                    return acc + numeric;
                }, 0);
            }, [priorityWeightsDraft]);
            const groupConfigValidationErrors = React.useMemo(() => {
                const errors = [];
                if (canEditSharedConfiguration) {
                    if (!selectedProjectsDraft.length) {
                        errors.push('Add at least one dashboard project before saving.');
                    }
                    if (!sprintFieldIdDraft) {
                        errors.push('Sprint field is required.');
                    }
                    if (!parentNameFieldIdDraft) {
                        errors.push('Parent name field is required.');
                    }
                    if (!storyPointsFieldIdDraft) {
                        errors.push('Story points field is required.');
                    }
                    if (!teamFieldIdDraft) {
                        errors.push('Team field is required.');
                    }
                    if (capacityProjectDraft && !capacityFieldIdDraft) {
                        errors.push('Capacity field is required when a capacity project is selected.');
                    }
                    if (!capacityProjectDraft && capacityFieldIdDraft) {
                        errors.push('Capacity project is required when a capacity field is selected.');
                    }
                    if (priorityWeightsValidationError) {
                        errors.push(priorityWeightsValidationError);
                    }
                }
                return errors;
            }, [canEditSharedConfiguration, selectedProjectsDraft, sprintFieldIdDraft, parentNameFieldIdDraft, storyPointsFieldIdDraft, teamFieldIdDraft, capacityProjectDraft, capacityFieldIdDraft, priorityWeightsValidationError]);
            const saveBlockedReason = React.useMemo(() => {
                if (groupSaving) return 'Save in progress';
                if (groupConfigValidationErrors.length > 0) return groupConfigValidationErrors[0];
                if (!isGroupDraftDirty) return 'No changes to save';
                return '';
            }, [groupSaving, groupConfigValidationErrors, isGroupDraftDirty]);

            const requestCloseGroupManage = () => {
                if (groupSaving) return;
                if (isGroupDraftDirty) {
                    setShowGroupDiscardConfirm(true);
                    return;
                }
                closeGroupManage();
            };

            const discardGroupDraftChanges = () => {
                setShowGroupDiscardConfirm(false);
                closeGroupManage();
            };
            const labelsTabEnabled = (groupDraft?.groups || groupsConfig.groups || []).length > 0;
            const openEpmSettingsTab = () => {
                if (!canEditEpmConfiguration) {
                    return;
                }
                resetEpmSettingsProjectRows();
                setShowGroupManage(true);
                setGroupManageTab('epm');
                setEpmSettingsTab('projects');
            };

            const openUserConnectionsSettings = () => {
                setShowGroupManage(true);
                setGroupManageTab('connections');
            };

            const focusEpmScopeField = React.useCallback((field) => {
                setEpmSettingsTab('scope');
                window.requestAnimationFrame(() => {
                    const selector = field === 'labelPrefix'
                        ? '[data-epm-scope-field="labelPrefix"]'
                        : '[data-epm-scope-field="subGoal"]';
                    const node = document.querySelector(selector);
                    if (node && typeof node.focus === 'function') {
                        node.focus();
                    }
                });
            }, []);

            const handleEpmSettingsTabKeyDown = (event) => {
                const tabs = ['scope', 'projects'];
                const focusTab = (tab) => {
                    window.requestAnimationFrame(() => {
                        const node = document.getElementById(`epm-settings-${tab}-tab`);
                        if (node && typeof node.focus === 'function') {
                            node.focus();
                        }
                    });
                };
                const currentIndex = tabs.indexOf(epmSettingsTab);
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const direction = event.key === 'ArrowRight' ? 1 : -1;
                    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
                    const nextTab = tabs[nextIndex];
                    setEpmSettingsTab(nextTab);
                    focusTab(nextTab);
                    return;
                }
                if (event.key === 'Home') {
                    event.preventDefault();
                    setEpmSettingsTab('scope');
                    focusTab('scope');
                    return;
                }
                if (event.key === 'End') {
                    event.preventDefault();
                    setEpmSettingsTab('projects');
                    focusTab('projects');
                }
            };

            const focusSettingsSubTab = (prefix, tab) => {
                window.requestAnimationFrame(() => {
                    const node = document.getElementById(`${prefix}-${tab}-tab`);
                    if (node && typeof node.focus === 'function') {
                        node.focus();
                    }
                });
            };

            const handleSettingsSubTabKeyDown = (event, tabs, currentTab, setTab, prefix) => {
                const currentIndex = Math.max(0, tabs.indexOf(currentTab));
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const direction = event.key === 'ArrowRight' ? 1 : -1;
                    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
                    const nextTab = tabs[nextIndex];
                    setTab(nextTab);
                    focusSettingsSubTab(prefix, nextTab);
                    return;
                }
                if (event.key === 'Home') {
                    event.preventDefault();
                    setTab(tabs[0]);
                    focusSettingsSubTab(prefix, tabs[0]);
                    return;
                }
                if (event.key === 'End') {
                    event.preventDefault();
                    const nextTab = tabs[tabs.length - 1];
                    setTab(nextTab);
                    focusSettingsSubTab(prefix, nextTab);
                }
            };

            const selectDepartmentSettingsTab = (tab) => {
                if (tab === 'labels' && !labelsTabEnabled) return;
                setDepartmentSettingsTab(tab);
                setGroupManageTab(tab);
            };

            const selectAdminSettingsTab = (tab) => {
                setAdminSettingsTab(tab);
                setGroupManageTab(tab);
            };

            const handleDepartmentSettingsTabKeyDown = (event) => {
                handleSettingsSubTabKeyDown(
                    event,
                    labelsTabEnabled ? ['teams', 'labels'] : ['teams'],
                    departmentSettingsTab,
                    selectDepartmentSettingsTab,
                    'department-settings'
                );
            };

            const handleAdminSettingsTabKeyDown = (event) => {
                handleSettingsSubTabKeyDown(
                    event,
                    ['scope', 'source', 'mapping', 'capacity', 'priorityWeights'],
                    adminSettingsTab,
                    selectAdminSettingsTab,
                    'admin-settings'
                );
            };

            const closeAllTeamSearchDropdowns = () => {
                setTeamSearchOpen(prev => {
                    const next = { ...prev };
                    Object.keys(next).forEach(key => {
                        next[key] = false;
                    });
                    return next;
                });
            };

            const setTeamFeedback = (groupId, message, tone = 'neutral') => {
                if (!groupId) return;
                setTeamSearchFeedback(prev => ({
                    ...prev,
                    [groupId]: { message, tone }
                }));
                if (teamSearchFeedbackTimersRef.current[groupId]) {
                    clearTimeout(teamSearchFeedbackTimersRef.current[groupId]);
                }
                teamSearchFeedbackTimersRef.current[groupId] = window.setTimeout(() => {
                    setTeamSearchFeedback(prev => {
                        const next = { ...prev };
                        delete next[groupId];
                        return next;
                    });
                    delete teamSearchFeedbackTimersRef.current[groupId];
                }, 2200);
            };

            const addGroupDraftRow = () => {
                let nextId = '';
                handleGroupDraftChange(prev => {
                    const existingIds = new Set((prev.groups || []).map(group => group.id));
                    nextId = buildGroupId('New Group', existingIds);
                    const nextGroup = {
                        id: nextId,
                        name: 'New Group',
                        teamIds: [],
                        missingInfoComponents: [],
                        excludedCapacityEpics: []
                    };
                    return {
                        ...prev,
                        groups: [...(prev.groups || []), nextGroup]
                    };
                });
                if (nextId) {
                    setActiveGroupDraftId(nextId);
                    setShowGroupListMobile(false);
                }
            };

            const updateGroupDraftName = (groupId, name) => {
                handleGroupDraftChange(prev => ({
                    ...prev,
                    groups: (prev.groups || []).map(group =>
                        group.id === groupId ? { ...group, name } : group
                    )
                }));
            };

            const duplicateGroupDraft = (groupId) => {
                let nextId = '';
                handleGroupDraftChange(prev => {
                    const source = (prev.groups || []).find(group => group.id === groupId);
                    if (!source) return prev;
                    const existingIds = new Set((prev.groups || []).map(group => group.id));
                    const nextName = `${source.name || 'Group'} Copy`;
                    nextId = buildGroupId(nextName, existingIds);
                    const nextGroup = {
                        ...source,
                        id: nextId,
                        name: nextName
                    };
                    return {
                        ...prev,
                        groups: [...(prev.groups || []), nextGroup]
                    };
                });
                if (nextId) {
                    setActiveGroupDraftId(nextId);
                    setShowGroupListMobile(false);
                }
            };

            const updateGroupDraftTeams = (groupId, rawTeams) => {
                const teamIds = parseTeamIdList(rawTeams);
                handleGroupDraftChange(prev => ({
                    ...prev,
                    groups: (prev.groups || []).map(group =>
                        group.id === groupId ? { ...group, teamIds } : group
                    )
                }));
            };

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

            const toggleTeamInGroup = (groupId, teamId) => {
                handleGroupDraftChange(prev => ({
                    ...prev,
                    groups: (prev.groups || []).map(group => {
                        if (group.id !== groupId) return group;
                        const currentTeams = group.teamIds || [];
                        const hasTeam = currentTeams.includes(teamId);
                        const newTeams = hasTeam
                            ? currentTeams.filter(id => id !== teamId)
                            : [...currentTeams, teamId];
                        return { ...group, teamIds: newTeams };
                    })
                }));
            };

            const focusTeamSearchInput = (groupId) => {
                const node = teamSearchInputRefs.current[groupId];
                if (node && typeof node.focus === 'function') {
                    node.focus();
                }
            };

            const addTeamToGroup = (groupId, teamId) => {
                let added = false;
                let alreadyAdded = false;
                let limitReached = false;
                handleGroupDraftChange(prev => ({
                    ...prev,
                    groups: (prev.groups || []).map(group => {
                        if (group.id !== groupId) return group;
                        const currentTeams = group.teamIds || [];
                        if (currentTeams.includes(teamId)) {
                            alreadyAdded = true;
                            return group;
                        }
                        if (currentTeams.length >= 12) {
                            limitReached = true;
                            return group;
                        }
                        added = true;
                        return {
                            ...group,
                            teamIds: [...currentTeams, teamId],
                            teamLabels: { ...(group.teamLabels || {}) }
                        };
                    })
                }));
                if (alreadyAdded) {
                    setTeamFeedback(groupId, 'Already added');
                }
                if (limitReached) {
                    setTeamFeedback(groupId, 'Limit reached (12 max)', 'warn');
                }
                if (added) {
                    setTeamSearchOpen(prev => ({ ...prev, [groupId]: true }));
                    focusTeamSearchInput(groupId);
                }
            };

            const removeTeamFromGroup = (groupId, teamId) => {
                handleGroupDraftChange(prev => ({
                    ...prev,
                    groups: (prev.groups || []).map(group => {
                        if (group.id !== groupId) return group;
                        const nextTeamLabels = { ...(group.teamLabels || {}) };
                        delete nextTeamLabels[teamId];
                        return {
                            ...group,
                            teamIds: (group.teamIds || []).filter(id => id !== teamId),
                            teamLabels: nextTeamLabels
                        };
                    })
                }));
            };

            const setTeamLabelForGroup = (groupId, teamId, label) => {
                const nextLabel = String(label || '').trim();
                handleGroupDraftChange(prev => ({
                    ...prev,
                    groups: (prev.groups || []).map(group => {
                        if (group.id !== groupId) return group;
                        const nextTeamLabels = { ...(group.teamLabels || {}) };
                        if (nextLabel) {
                            nextTeamLabels[teamId] = nextLabel;
                        } else {
                            delete nextTeamLabels[teamId];
                        }
                        return { ...group, teamLabels: nextTeamLabels };
                    })
                }));
            };

            const handleTeamSearchChange = (groupId, value) => {
                setTeamSearchQuery(prev => ({ ...prev, [groupId]: value }));
                setTeamSearchOpen(prev => ({ ...prev, [groupId]: true }));
                setTeamSearchIndex(prev => ({ ...prev, [groupId]: 0 }));
                if (teamSearchFeedback[groupId]) {
                    setTeamSearchFeedback(prev => {
                        const next = { ...prev };
                        delete next[groupId];
                        return next;
                    });
                }
            };

            const handleTeamSearchFocus = (groupId) => {
                setTeamSearchOpen(prev => ({ ...prev, [groupId]: true }));
            };

            const handleTeamSearchBlur = (groupId) => {
                window.setTimeout(() => {
                    setTeamSearchOpen(prev => ({ ...prev, [groupId]: false }));
                }, 120);
            };

            const focusLastTeamChip = (groupId) => {
                const node = teamChipLastRef.current[groupId];
                if (node && typeof node.focus === 'function') {
                    node.focus();
                }
            };

            const getGroupTeamSearchResults = (group, queryText) => {
                if (!group) return [];
                const teamsInOtherGroups = new Set();
                (groupDraft?.groups || []).forEach(g => {
                    if (g.id !== group.id) {
                        (g.teamIds || []).forEach(teamId => teamsInOtherGroups.add(teamId));
                    }
                });
                const currentTeams = new Set(group.teamIds || []);
                const query = String(queryText || '').toLowerCase();
                return availableTeams.filter(team => {
                    if (currentTeams.has(team.id)) return false;
                    if (teamsInOtherGroups.has(team.id)) return false;
                    const nameLower = String(team.name || '').toLowerCase();
                    return nameLower.includes(query);
                });
            };

            const handleTeamSearchKeyDown = (groupId, event, results) => {
                if (!groupId) return;
                const value = teamSearchQuery[groupId] || '';
                if (event.key === 'ArrowDown') {
                    if (!results.length) return;
                    event.preventDefault();
                    setTeamSearchIndex(prev => ({
                        ...prev,
                        [groupId]: Math.min((prev[groupId] || 0) + 1, results.length - 1)
                    }));
                    return;
                }
                if (event.key === 'ArrowUp') {
                    if (!results.length) return;
                    event.preventDefault();
                    setTeamSearchIndex(prev => ({
                        ...prev,
                        [groupId]: Math.max((prev[groupId] || 0) - 1, 0)
                    }));
                    return;
                }
                if (event.key === 'Enter') {
                    if (!results.length) return;
                    event.preventDefault();
                    const index = teamSearchIndex[groupId] || 0;
                    const team = results[index] || results[0];
                    if (team?.id) {
                        addTeamToGroup(groupId, team.id);
                    }
                    return;
                }
                if (event.key === 'Escape') {
                    if (teamSearchOpen[groupId]) {
                        event.preventDefault();
                        event.stopPropagation();
                        setTeamSearchOpen(prev => ({ ...prev, [groupId]: false }));
                    }
                    return;
                }
                if (event.key === 'Backspace' && !value) {
                    focusLastTeamChip(groupId);
                }
            };

            const removeGroupDraft = (groupId) => {
                let nextActiveId = activeGroupDraftId;
                handleGroupDraftChange(prev => {
                    const nextGroups = (prev.groups || []).filter(group => group.id !== groupId);
                    const nextDefault = prev.defaultGroupId === groupId ? '' : prev.defaultGroupId;
                    if (activeGroupDraftId === groupId) {
                        nextActiveId = nextGroups[0]?.id || null;
                    }
                    return {
                        ...prev,
                        groups: nextGroups,
                        defaultGroupId: nextDefault
                    };
                });
                if (activeGroupDraftId === groupId) {
                    setActiveGroupDraftId(nextActiveId);
                }
            };

            const toggleDefaultGroupDraft = (groupId) => {
                handleGroupDraftChange(prev => ({
                    ...prev,
                    defaultGroupId: prev.defaultGroupId === groupId ? '' : groupId
                }));
            };

            const testGroupsConfigConnection = async () => {
                setGroupTesting(true);
                setGroupTestMessage('');
                try {
                    const response = await testJiraConnection(BACKEND_URL);
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(payload.error || `Test failed (${response.status})`);
                    }
                    setGroupTestMessage(payload.message || 'Connection to Jira API looks good.');
                } catch (error) {
                    setGroupTestMessage(error?.message || 'Connection test failed.');
                } finally {
                    setGroupTesting(false);
                }
            };

            const saveGroupsConfig = async () => {
                if (!groupDraft) return;
                if (groupConfigValidationErrors.length > 0) {
                    setGroupDraftError(groupConfigValidationErrors[0]);
                    return;
                }
                setGroupSaving(true);
                setGroupDraftError('');
                try {
                    if (canEditEpmConfiguration && isEpmConfigDirty) {
                        await saveEpmConfig();
                    }

                    let projectsChanged = false;
                    let priorityWeightsChanged = false;
                    let boardChanged = false;
                    let capacityChanged = false;
                    let fieldConfigsChanged = false;
                    let issueTypesChanged = false;

                    if (canEditSharedConfiguration) {
                        // Save project selection if changed
                        projectsChanged = isProjectsDraftDirty;
                        if (projectsChanged) {
                            await saveProjectSelection();
                        }

                        priorityWeightsChanged = isPriorityWeightsDirty;
                        if (priorityWeightsChanged) {
                            await savePriorityWeightsConfig();
                        }

                        boardChanged = isBoardConfigDirty;
                        if (boardChanged) {
                            await saveBoardConfig();
                        }

                        // Save capacity config if changed
                        capacityChanged = isCapacityDraftDirty;
                        if (capacityChanged) {
                            await saveCapacityConfig();
                        }

                        // Save custom field configs if changed
                        if (isSprintFieldDirty) await saveSprintFieldConfig();
                        if (isParentNameFieldDirty) await saveParentNameFieldConfig();
                        if (isStoryPointsFieldDirty) await saveStoryPointsFieldConfig();
                        if (isTeamFieldDirty) await saveTeamFieldConfig();
                        fieldConfigsChanged = isSprintFieldDirty || isParentNameFieldDirty || isStoryPointsFieldDirty || isTeamFieldDirty;

                        // Save issue types config if changed
                        issueTypesChanged = isIssueTypesDraftDirty;
                        if (issueTypesChanged) {
                            await saveIssueTypesConfig();
                        }
                    }

                    // Capture the current active group's team IDs before saving
                    const currentActiveGroup = activeGroupId ? (groupsConfig.groups || []).find(g => g.id === activeGroupId) : null;
                    const currentTeamSignature = currentActiveGroup ? (currentActiveGroup.teamIds || []).join('|') : null;

                    const response = await requestSaveGroupsConfig(BACKEND_URL, {
                        version: groupDraft.version || 1,
                        groups: groupDraft.groups || [],
                        defaultGroupId: groupDraft.defaultGroupId || '',
                    });
                    if (!response.ok) {
                        const errorPayload = await response.json().catch(() => ({}));
                        const errorMessage = (errorPayload.errors || []).join(' ') || errorPayload.error || `Save failed (${response.status})`;
                        throw new Error(errorMessage);
                    }
                    const payload = await response.json();
                    const normalized = normalizeGroupsConfig(payload);
                    const refreshTarget = getConfigSaveRefreshTarget({
                        selectedSprint,
                        showScenario
                    });

                    // Check if the active group's team IDs changed
                    if (activeGroupId && currentTeamSignature !== null) {
                        const updatedActiveGroup = (normalized.groups || []).find(g => g.id === activeGroupId);
                        const updatedTeamSignature = updatedActiveGroup ? (updatedActiveGroup.teamIds || []).join('|') : null;

                        // If team IDs changed, invalidate the cache for this group to force data reload
                        if (currentTeamSignature !== updatedTeamSignature) {
                            groupStateRef.current.delete(activeGroupId);
                        }
                    }

                    // If projects or capacity changed, invalidate all group caches to refetch with new scope
                    if (projectsChanged || priorityWeightsChanged || boardChanged || capacityChanged || issueTypesChanged || fieldConfigsChanged) {
                        groupStateRef.current.clear();
                    }

                    setGroupsConfig(normalized);
                    setGroupWarnings(payload.warnings || []);
                    setGroupConfigSource(payload.source || '');
                    setActiveGroupId(prev => {
                        if (prev && normalized.groups.some(group => group.id === prev)) {
                            return prev;
                        }
                        return resolveInitialGroupId(normalized);
                    });

                    // Re-fetch config to update capacityEnabled and other derived state
                    try {
                        const cfg = await fetchAppConfig(BACKEND_URL);
                        setAuthMode(cfg.authMode || '');
                        setCapacityEnabled(Boolean(cfg.capacityProject));
                        setSettingsAdminOnly(Boolean(cfg.settingsAdminOnly));
                        setUserCanEditSettings(cfg.userCanEditSettings === true);
                        setUserCanEditEpmConfig(cfg.userCanEditEpmConfig === true);
                        setEnvironmentConfigExists(Boolean(cfg.environmentConfigExists || cfg.projectsConfigured));
                    } catch (_) { /* best-effort */ }

                    invalidateSprintDataForConfigSave(refreshTarget);
                    queueConfigSaveRefresh(refreshTarget);

                    if (boardChanged) {
                        loadSprints(true);
                    }

                    closeGroupManage();
                } catch (err) {
                    setGroupDraftError(err.message || 'Failed to save groups.');
                } finally {
                    setGroupSaving(false);
                }
            };

            useEffect(() => {
                if (!showGroupManage) return;
                const handleKey = (event) => {
                    const key = event.key;
                    if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 's') {
                        event.preventDefault();
                        if (groupManageTab === 'connections') {
                            return;
                        }
                        if (groupManageTab === 'epm') {
                            if (canEditEpmConfiguration && !epmConfigSaving) {
                                void saveEpmConfig().catch(() => {});
                            }
                        } else if (!groupSaving) {
                            saveGroupsConfig();
                        }
                        return;
                    }
                    if (key === 'Escape') {
                        const hasOpenDropdown = Object.values(teamSearchOpen || {}).some(Boolean);
                        if (hasOpenDropdown) {
                            event.preventDefault();
                            closeAllTeamSearchDropdowns();
                            return;
                        }
                        if (showGroupDiscardConfirm) {
                            event.preventDefault();
                            setShowGroupDiscardConfirm(false);
                            return;
                        }
                        event.preventDefault();
                        requestCloseGroupManage();
                    }
                };
                window.addEventListener('keydown', handleKey);
                return () => window.removeEventListener('keydown', handleKey);
            }, [showGroupManage, groupManageTab, groupSaving, epmConfigSaving, canEditEpmConfiguration, teamSearchOpen, showGroupDiscardConfirm, requestCloseGroupManage, saveEpmConfig, saveGroupsConfig]);

            const fetchJiraProjects = async () => {
                setLoadingProjects(true);
                try {
                    const response = await requestJiraProjects(BACKEND_URL);
                    if (!response.ok) throw new Error(`Projects fetch error ${response.status}`);
                    const data = await response.json();
                    setJiraProjects(data.projects || []);
                } catch (err) {
                    console.error('Failed to fetch Jira projects:', err);
                } finally {
                    setLoadingProjects(false);
                }
            };

            const fetchJiraBoards = async () => {
                setLoadingBoards(true);
                try {
                    const response = await requestJiraBoards(BACKEND_URL);
                    if (!response.ok) throw new Error(`Boards fetch error ${response.status}`);
                    const data = await response.json();
                    setJiraBoards(data.boards || []);
                } catch (err) {
                    console.error('Failed to fetch Jira boards:', err);
                } finally {
                    setLoadingBoards(false);
                }
            };

            useEffect(() => {
                const query = projectSearchQuery.trim();
                if (!showGroupManage || groupManageTab !== 'scope' || !query) {
                    setProjectSearchRemoteResults([]);
                    setProjectSearchRemoteLoading(false);
                    return undefined;
                }

                const controller = new AbortController();
                const timeoutId = window.setTimeout(async () => {
                    setProjectSearchRemoteLoading(true);
                    try {
                        const response = await requestProjectSearch(BACKEND_URL, { query, signal: controller.signal });
                        if (!response.ok) throw new Error(`Projects search error ${response.status}`);
                        const data = await response.json();
                        setProjectSearchRemoteResults(data.projects || []);
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            console.error('Failed to search Jira projects:', err);
                            setProjectSearchRemoteResults([]);
                        }
                    } finally {
                        if (!controller.signal.aborted) {
                            setProjectSearchRemoteLoading(false);
                        }
                    }
                }, 220);

                return () => {
                    window.clearTimeout(timeoutId);
                    controller.abort();
                };
            }, [showGroupManage, groupManageTab, projectSearchQuery]);

            useEffect(() => {
                const query = boardSearchQuery.trim();
                if (!showGroupManage || groupManageTab !== 'source' || boardIdDraft || !query) {
                    setBoardSearchRemoteResults([]);
                    setBoardSearchRemoteLoading(false);
                    return undefined;
                }

                const controller = new AbortController();
                const timeoutId = window.setTimeout(async () => {
                    setBoardSearchRemoteLoading(true);
                    try {
                        const response = await requestBoardSearch(BACKEND_URL, { query, signal: controller.signal });
                        if (!response.ok) throw new Error(`Boards search error ${response.status}`);
                        const data = await response.json();
                        setBoardSearchRemoteResults(data.boards || []);
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            console.error('Failed to search Jira boards:', err);
                            setBoardSearchRemoteResults([]);
                        }
                    } finally {
                        if (!controller.signal.aborted) {
                            setBoardSearchRemoteLoading(false);
                        }
                    }
                }, 220);

                return () => {
                    window.clearTimeout(timeoutId);
                    controller.abort();
                };
            }, [showGroupManage, groupManageTab, boardIdDraft, boardSearchQuery]);

            // Component search debounced fetch
            useEffect(() => {
                const query = componentSearchQuery.trim();
                if (!showGroupManage || groupManageTab !== 'teams' || !query) {
                    setComponentSearchResults([]);
                    setComponentSearchLoading(false);
                    return undefined;
                }

                const controller = new AbortController();
                const timeoutId = window.setTimeout(async () => {
                    setComponentSearchLoading(true);
                    try {
                        const response = await requestComponentSearch(BACKEND_URL, { query, signal: controller.signal });
                        if (!response.ok) throw new Error(`Components search error ${response.status}`);
                        const data = await response.json();
                        setComponentSearchResults(data.components || []);
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            console.error('Failed to search components:', err);
                            setComponentSearchResults([]);
                        }
                    } finally {
                        if (!controller.signal.aborted) {
                            setComponentSearchLoading(false);
                        }
                    }
                }, 220);

                return () => {
                    window.clearTimeout(timeoutId);
                    controller.abort();
                };
            }, [showGroupManage, groupManageTab, componentSearchQuery]);

            // Excluded epic search debounced fetch
            useEffect(() => {
                const query = excludedEpicSearchQuery.trim();
                if (!showGroupManage || groupManageTab !== 'teams' || !query) {
                    setExcludedEpicSearchResults([]);
                    setExcludedEpicSearchLoading(false);
                    return undefined;
                }

                const controller = new AbortController();
                const timeoutId = window.setTimeout(async () => {
                    setExcludedEpicSearchLoading(true);
                    try {
                        const response = await requestEpicSearch(BACKEND_URL, { query, signal: controller.signal });
                        if (!response.ok) throw new Error(`Excluded epics search error ${response.status}`);
                        const data = await response.json();
                        setExcludedEpicSearchResults(data.epics || []);
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            console.error('Failed to search excluded epics:', err);
                            setExcludedEpicSearchResults([]);
                        }
                    } finally {
                        if (!controller.signal.aborted) {
                            setExcludedEpicSearchLoading(false);
                        }
                    }
                }, 220);

                return () => {
                    window.clearTimeout(timeoutId);
                    controller.abort();
                };
            }, [showGroupManage, groupManageTab, excludedEpicSearchQuery]);

            const filteredComponentSearchResults = React.useMemo(() => {
                const group = activeGroupDraftId
                    ? (groupDraft?.groups || []).find(g => g.id === activeGroupDraftId)
                    : null;
                const selected = new Set((group?.missingInfoComponents || []).map(c => c.toLowerCase()));
                return componentSearchResults.filter(c => !selected.has(c.name.toLowerCase()));
            }, [componentSearchResults, groupDraft, activeGroupDraftId]);

            const filteredExcludedEpicSearchResults = React.useMemo(() => {
                const group = activeGroupDraftId
                    ? (groupDraft?.groups || []).find(g => g.id === activeGroupDraftId)
                    : null;
                const selected = new Set((group?.excludedCapacityEpics || []).map(key => String(key || '').trim().toUpperCase()));
                return excludedEpicSearchResults.filter((epic) => {
                    const key = String(epic?.key || '').trim().toUpperCase();
                    return key && !selected.has(key);
                });
            }, [excludedEpicSearchResults, groupDraft, activeGroupDraftId]);

            React.useEffect(() => {
                const maxIndex = filteredComponentSearchResults.length - 1;
                if (componentSearchIndex > maxIndex) setComponentSearchIndex(0);
            }, [filteredComponentSearchResults.length]);

            React.useEffect(() => {
                const maxIndex = filteredExcludedEpicSearchResults.length - 1;
                if (excludedEpicSearchIndex > maxIndex) setExcludedEpicSearchIndex(0);
            }, [filteredExcludedEpicSearchResults.length]);

            const handleComponentSearchKeyDown = (event) => {
                if (event.key === 'ArrowDown') {
                    if (!filteredComponentSearchResults.length) return;
                    event.preventDefault();
                    setComponentSearchIndex(prev => Math.min(prev + 1, filteredComponentSearchResults.length - 1));
                } else if (event.key === 'ArrowUp') {
                    if (!filteredComponentSearchResults.length) return;
                    event.preventDefault();
                    setComponentSearchIndex(prev => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                    if (!filteredComponentSearchResults.length) return;
                    event.preventDefault();
                    const comp = filteredComponentSearchResults[componentSearchIndex] || filteredComponentSearchResults[0];
                    if (comp && activeGroupDraft) addGroupMissingInfoComponent(activeGroupDraft.id, comp.name);
                } else if (event.key === 'Escape') {
                    if (componentSearchOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        setComponentSearchOpen(false);
                    }
                }
            };

            const addGroupMissingInfoComponent = (groupId, componentName) => {
                setGroupDraft(prev => {
                    if (!prev) return prev;
                    const groups = (prev.groups || []).map(g => {
                        if (g.id !== groupId) return g;
                        const existing = g.missingInfoComponents || [];
                        if (existing.some(c => c.toLowerCase() === componentName.toLowerCase())) return g;
                        return { ...g, missingInfoComponents: [...existing, componentName] };
                    });
                    return { ...prev, groups };
                });
                setComponentSearchQuery('');
                setComponentSearchOpen(false);
            };

            const removeGroupMissingInfoComponent = (groupId, componentName) => {
                setGroupDraft(prev => {
                    if (!prev) return prev;
                    const groups = (prev.groups || []).map(g => {
                        if (g.id !== groupId) return g;
                        return { ...g, missingInfoComponents: (g.missingInfoComponents || []).filter(c => c !== componentName) };
                    });
                    return { ...prev, groups };
                });
            };

            const addGroupExcludedCapacityEpic = (groupId, epicKey) => {
                const normalizedKey = String(epicKey || '').trim().toUpperCase();
                if (!normalizedKey) return;
                let added = false;
                setGroupDraft(prev => {
                    if (!prev) return prev;
                    const groups = (prev.groups || []).map(g => {
                        if (g.id !== groupId) return g;
                        const existing = (g.excludedCapacityEpics || []).map(key => String(key || '').trim().toUpperCase());
                        if (existing.includes(normalizedKey)) return g;
                        added = true;
                        return { ...g, excludedCapacityEpics: [...existing, normalizedKey] };
                    });
                    return { ...prev, groups };
                });
                if (added) {
                    setExcludedEpicSearchOpen(true);
                    focusExcludedEpicSearchInput();
                }
            };

            const removeGroupExcludedCapacityEpic = (groupId, epicKey) => {
                const normalizedKey = String(epicKey || '').trim().toUpperCase();
                setGroupDraft(prev => {
                    if (!prev) return prev;
                    const groups = (prev.groups || []).map(g => {
                        if (g.id !== groupId) return g;
                        return {
                            ...g,
                            excludedCapacityEpics: (g.excludedCapacityEpics || [])
                                .map(key => String(key || '').trim().toUpperCase())
                                .filter(key => key !== normalizedKey)
                        };
                    });
                    return { ...prev, groups };
                });
            };

            const handleExcludedEpicSearchKeyDown = (event) => {
                const value = excludedEpicSearchQuery || '';
                if (event.key === 'ArrowDown') {
                    if (!filteredExcludedEpicSearchResults.length) return;
                    event.preventDefault();
                    setExcludedEpicSearchIndex(prev => Math.min(prev + 1, filteredExcludedEpicSearchResults.length - 1));
                } else if (event.key === 'ArrowUp') {
                    if (!filteredExcludedEpicSearchResults.length) return;
                    event.preventDefault();
                    setExcludedEpicSearchIndex(prev => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                    if (!filteredExcludedEpicSearchResults.length) return;
                    event.preventDefault();
                    const epic = filteredExcludedEpicSearchResults[excludedEpicSearchIndex] || filteredExcludedEpicSearchResults[0];
                    if (epic && activeGroupDraft) addGroupExcludedCapacityEpic(activeGroupDraft.id, epic.key);
                } else if (event.key === 'Escape') {
                    if (excludedEpicSearchOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        setExcludedEpicSearchOpen(false);
                    }
                } else if (event.key === 'Backspace' && !value) {
                    const node = excludedEpicChipLastRef.current;
                    if (node && typeof node.focus === 'function') {
                        node.focus();
                    }
                }
            };

            const focusExcludedEpicSearchInput = () => {
                const node = excludedEpicSearchInputRef.current;
                if (node && typeof node.focus === 'function') {
                    node.focus();
                }
            };

            const handleExcludedEpicSearchChange = (value) => {
                setExcludedEpicSearchQuery(value);
                setExcludedEpicSearchOpen(true);
                setExcludedEpicSearchIndex(0);
            };

            const handleExcludedEpicSearchFocus = () => {
                setExcludedEpicSearchOpen(true);
            };

            const handleExcludedEpicSearchBlur = () => {
                window.setTimeout(() => {
                    setExcludedEpicSearchOpen(false);
                }, 120);
            };

            const loadSelectedProjects = async () => {
                try {
                    const response = await requestSelectedProjects(BACKEND_URL);
                    if (!response.ok) throw new Error(`Selected projects fetch error ${response.status}`);
                    const data = await response.json();
                    const selected = data.selected || [];
                    clearServerConnectionError();
                    setSelectedProjectsDraft(selected);
                    setSavedSelectedProjects(selected);
                    selectedProjectsBaselineRef.current = JSON.stringify(selected);
                } catch (err) {
                    if (!reportServerConnectionError(err)) {
                        console.error('Failed to load selected projects:', err);
                    }
                }
            };

            const loadBoardConfig = async () => {
                try {
                    const response = await requestBoardConfig(BACKEND_URL);
                    if (!response.ok) return;
                    const data = await response.json();
                    const nextBoardId = String(data.boardId || '');
                    const nextBoardName = String(data.boardName || '');
                    setBoardIdDraft(nextBoardId);
                    setBoardNameDraft(nextBoardName);
                    boardConfigBaselineRef.current = JSON.stringify({ boardId: nextBoardId, boardName: nextBoardName });
                } catch (err) {
                    console.error('Failed to load board config:', err);
                }
            };

            const loadPriorityWeightsConfig = async () => {
                try {
                    const response = await requestPriorityWeightsConfig(BACKEND_URL);
                    if (!response.ok) return;
                    const data = await response.json();
                    const rows = clonePriorityWeightRows(data.weights);
                    clearServerConnectionError();
                    setPriorityWeightsDraft(rows);
                    setEffectivePriorityWeightsRows(rows);
                    setPriorityWeightsSource(String(data.source || 'default'));
                    priorityWeightsBaselineRef.current = JSON.stringify(rows);
                } catch (err) {
                    if (!reportServerConnectionError(err)) {
                        console.error('Failed to load priority weights config:', err);
                    }
                }
            };

            const saveBoardConfig = async () => {
                const response = await requestSaveBoardConfig(BACKEND_URL, { boardId: boardIdDraft, boardName: boardNameDraft });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${response.status})`);
                }
                boardConfigBaselineRef.current = JSON.stringify({ boardId: boardIdDraft, boardName: boardNameDraft });
            };

            const savePriorityWeightsConfig = async () => {
                const response = await requestSavePriorityWeightsConfig(BACKEND_URL, (priorityWeightsDraft || []).map((row) => ({
                    priority: String(row.priority || '').trim(),
                    weight: Number(row.weight)
                })));
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${response.status})`);
                }
                const data = await response.json();
                const rows = clonePriorityWeightRows(data.weights);
                setPriorityWeightsDraft(rows);
                setEffectivePriorityWeightsRows(rows);
                setPriorityWeightsSource(String(data.source || 'config'));
                priorityWeightsBaselineRef.current = JSON.stringify(rows);
            };

            const addProjectSelection = (key, type = 'product') => {
                setSelectedProjectsDraft(prev => {
                    if (prev.some(p => p.key === key)) return prev;
                    return [...prev, { key, type }];
                });
                setProjectSearchQuery('');
                setProjectSearchOpen(true);
                if (projectSearchInputRef.current) projectSearchInputRef.current.focus();
            };

            const clearBoardSelection = () => {
                setBoardIdDraft('');
                setBoardNameDraft('');
                setBoardSearchQuery('');
                setBoardSearchOpen(false);
            };

            const updatePriorityWeightDraft = (priorityName, nextValue) => {
                setPriorityWeightsDraft((prev) => (prev || []).map((row) => (
                    row.priority === priorityName ? { ...row, weight: nextValue } : row
                )));
            };

            const resetPriorityWeightsDraft = () => {
                setPriorityWeightsDraft(clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS));
            };

            const removeProjectSelection = (key) => {
                setSelectedProjectsDraft(prev => prev.filter(p => p.key !== key));
            };

            const selectedProjectKeys = React.useMemo(() => {
                return new Set(selectedProjectsDraft.map(p => p.key));
            }, [selectedProjectsDraft]);

            const boardSearchResults = React.useMemo(() => {
                const query = boardSearchQuery.trim().toLowerCase();
                if (!query) return [];
                return (boardSearchRemoteResults || [])
                    .filter((board) => {
                        const id = String(board.id || '');
                        const name = String(board.name || '');
                        return id.includes(query) || name.toLowerCase().includes(query);
                    })
                    .slice(0, 20);
            }, [boardSearchQuery, boardSearchRemoteResults]);

            const projectSearchResults = React.useMemo(() => {
                const query = projectSearchQuery.toLowerCase().trim();
                if (!query) return [];
                const sourceProjects = projectSearchRemoteResults.length > 0 ? projectSearchRemoteResults : jiraProjects;
                return sourceProjects.filter(p => {
                    if (selectedProjectKeys.has(p.key)) return false;
                    return p.key.toLowerCase().includes(query) || p.name.toLowerCase().includes(query);
                }).slice(0, 10);
            }, [projectSearchQuery, jiraProjects, projectSearchRemoteResults, selectedProjectsDraft]);

            React.useEffect(() => {
                const maxIndex = projectSearchResults.length - 1;
                if (projectSearchIndex > maxIndex) setProjectSearchIndex(0);
            }, [projectSearchResults.length]);

            React.useEffect(() => {
                const maxIndex = boardSearchResults.length - 1;
                if (boardSearchIndex > maxIndex) setBoardSearchIndex(0);
            }, [boardSearchResults.length]);

            const handleProjectSearchKeyDown = (event) => {
                if (event.key === 'ArrowDown') {
                    if (!projectSearchResults.length) return;
                    event.preventDefault();
                    setProjectSearchIndex(prev => Math.min(prev + 1, projectSearchResults.length - 1));
                } else if (event.key === 'ArrowUp') {
                    if (!projectSearchResults.length) return;
                    event.preventDefault();
                    setProjectSearchIndex(prev => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                    if (!projectSearchResults.length) return;
                    event.preventDefault();
                    const p = projectSearchResults[projectSearchIndex] || projectSearchResults[0];
                    if (p) addProjectSelection(p.key);
                } else if (event.key === 'Escape') {
                    if (projectSearchOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        setProjectSearchOpen(false);
                    }
                }
            };

            const handleBoardSearchKeyDown = (event) => {
                if (event.key === 'ArrowDown') {
                    if (!boardSearchResults.length) return;
                    event.preventDefault();
                    setBoardSearchIndex((prev) => Math.min(prev + 1, boardSearchResults.length - 1));
                } else if (event.key === 'ArrowUp') {
                    if (!boardSearchResults.length) return;
                    event.preventDefault();
                    setBoardSearchIndex((prev) => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                    if (!boardSearchResults.length) return;
                    event.preventDefault();
                    const board = boardSearchResults[boardSearchIndex] || boardSearchResults[0];
                    if (!board) return;
                    setBoardIdDraft(String(board.id || ''));
                    setBoardNameDraft(String(board.name || ''));
                    setBoardSearchQuery('');
                    setBoardSearchOpen(false);
                } else if (event.key === 'Escape') {
                    if (boardSearchOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        setBoardSearchOpen(false);
                    }
                }
            };

            const resolveProjectName = (key) => {
                const proj = jiraProjects.find(p => p.key === key);
                return proj ? proj.name : key;
            };

            const saveProjectSelection = async () => {
                setGroupSaving(true);
                setGroupDraftError('');
                try {
                    const response = await requestSaveSelectedProjects(BACKEND_URL, selectedProjectsDraft);
                    if (!response.ok) {
                        const errorPayload = await response.json().catch(() => ({}));
                        throw new Error(errorPayload.error || `Save failed (${response.status})`);
                    }
                    selectedProjectsBaselineRef.current = JSON.stringify(selectedProjectsDraft);
                    setSavedSelectedProjects([...selectedProjectsDraft]);
                } catch (err) {
                    setGroupDraftError(err.message || 'Failed to save project selection.');
                    throw err;
                } finally {
                    setGroupSaving(false);
                }
            };

            const loadCapacityConfig = async () => {
                try {
                    const response = await requestCapacityConfig(BACKEND_URL);
                    if (!response.ok) return;
                    const data = await response.json();
                    setCapacityProjectDraft(data.project || '');
                    setCapacityFieldIdDraft(data.fieldId || '');
                    setCapacityFieldNameDraft(data.fieldName || '');
                    capacityBaselineRef.current = JSON.stringify({ project: data.project || '', fieldId: data.fieldId || '', fieldName: data.fieldName || '' });
                } catch (err) {
                    console.error('Failed to load capacity config:', err);
                }
            };

            const saveCapacityConfig = async () => {
                const response = await requestSaveCapacityConfig(BACKEND_URL, { project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${response.status})`);
                }
                capacityBaselineRef.current = JSON.stringify({ project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft });
            };

            // Generic load/save helpers for custom field pickers
            const loadFieldConfig = async (endpoint, setId, setName, baselineRef) => {
                try {
                    const response = await requestFieldConfig(BACKEND_URL, endpoint);
                    if (!response.ok) return;
                    const data = await response.json();
                    setId(data.fieldId || '');
                    setName(data.fieldName || '');
                    baselineRef.current = JSON.stringify({ fieldId: data.fieldId || '', fieldName: data.fieldName || '' });
                } catch (err) {
                    console.error(`Failed to load ${endpoint} config:`, err);
                }
            };
            const saveFieldConfig = async (endpoint, fieldId, fieldName, baselineRef) => {
                const response = await requestSaveFieldConfig(BACKEND_URL, endpoint, { fieldId, fieldName });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${response.status})`);
                }
                baselineRef.current = JSON.stringify({ fieldId, fieldName });
            };

            const loadSprintFieldConfig = () => loadFieldConfig('sprint-field', setSprintFieldIdDraft, setSprintFieldNameDraft, sprintFieldBaselineRef);
            const saveSprintFieldConfig = () => saveFieldConfig('sprint-field', sprintFieldIdDraft, sprintFieldNameDraft, sprintFieldBaselineRef);
            const loadParentNameFieldConfig = () => loadFieldConfig('parent-name-field', setParentNameFieldIdDraft, setParentNameFieldNameDraft, parentNameFieldBaselineRef);
            const saveParentNameFieldConfig = () => saveFieldConfig('parent-name-field', parentNameFieldIdDraft, parentNameFieldNameDraft, parentNameFieldBaselineRef);
            const loadStoryPointsFieldConfig = () => loadFieldConfig('story-points-field', setStoryPointsFieldIdDraft, setStoryPointsFieldNameDraft, storyPointsFieldBaselineRef);
            const saveStoryPointsFieldConfig = () => saveFieldConfig('story-points-field', storyPointsFieldIdDraft, storyPointsFieldNameDraft, storyPointsFieldBaselineRef);
            const loadTeamFieldConfig = () => loadFieldConfig('team-field', setTeamFieldIdDraft, setTeamFieldNameDraft, teamFieldBaselineRef);
            const saveTeamFieldConfig = () => saveFieldConfig('team-field', teamFieldIdDraft, teamFieldNameDraft, teamFieldBaselineRef);

            const loadIssueTypesConfig = async () => {
                try {
                    const response = await requestIssueTypesConfig(BACKEND_URL);
                    if (!response.ok) return;
                    const data = await response.json();
                    const types = data.issueTypes || ['Story'];
                    setIssueTypesDraft(types);
                    issueTypesBaselineRef.current = JSON.stringify(types);
                } catch (err) {
                    console.error('Failed to load issue types config:', err);
                }
            };

            const saveIssueTypesConfig = async () => {
                const response = await requestSaveIssueTypesConfig(BACKEND_URL, issueTypesDraft);
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${response.status})`);
                }
                issueTypesBaselineRef.current = JSON.stringify(issueTypesDraft);
            };

            const fetchAvailableIssueTypes = async () => {
                try {
                    const response = await requestAvailableIssueTypes(BACKEND_URL);
                    if (!response.ok) return;
                    const data = await response.json();
                    setAvailableIssueTypes(data.issueTypes || []);
                } catch (err) {
                    console.error('Failed to fetch available issue types:', err);
                }
            };

            const addIssueType = (name) => {
                setIssueTypesDraft([name]);
                setIssueTypeSearchQuery('');
                setIssueTypeSearchOpen(false);
            };

            const removeIssueType = (name) => {
                setIssueTypesDraft(prev => prev.filter(t => t !== name));
            };

            const issueTypeSearchResults = React.useMemo(() => {
                const query = issueTypeSearchQuery.toLowerCase().trim();
                if (!query) return [];
                return availableIssueTypes.filter(it => {
                    if (issueTypesDraft.includes(it.name)) return false;
                    return it.name.toLowerCase().includes(query);
                }).slice(0, 10);
            }, [issueTypeSearchQuery, availableIssueTypes, issueTypesDraft]);

            React.useEffect(() => {
                if (issueTypeSearchIndex >= issueTypeSearchResults.length) setIssueTypeSearchIndex(0);
            }, [issueTypeSearchResults.length]);

            const handleIssueTypeSearchKeyDown = (event) => {
                if (event.key === 'ArrowDown') {
                    if (!issueTypeSearchResults.length) return;
                    event.preventDefault();
                    setIssueTypeSearchIndex(prev => Math.min(prev + 1, issueTypeSearchResults.length - 1));
                } else if (event.key === 'ArrowUp') {
                    if (!issueTypeSearchResults.length) return;
                    event.preventDefault();
                    setIssueTypeSearchIndex(prev => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                    if (!issueTypeSearchResults.length) return;
                    event.preventDefault();
                    const it = issueTypeSearchResults[issueTypeSearchIndex] || issueTypeSearchResults[0];
                    if (it) addIssueType(it.name);
                } else if (event.key === 'Escape') {
                    if (issueTypeSearchOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        setIssueTypeSearchOpen(false);
                    }
                }
            };

            const fetchJiraFields = async (projectKey) => {
                setLoadingFields(true);
                try {
                    const response = await requestJiraFields(BACKEND_URL, { projectKey });
                    if (!response.ok) throw new Error(`Fields fetch error ${response.status}`);
                    const data = await response.json();
                    setJiraFields(data.fields || []);
                } catch (err) {
                    console.error('Failed to fetch Jira fields:', err);
                } finally {
                    setLoadingFields(false);
                }
            };

            // Fetch fields when modal opens or capacity project changes
            React.useEffect(() => {
                if (!showGroupManage) return;
                fetchJiraFields(capacityProjectDraft || undefined);
            }, [capacityProjectDraft, showGroupManage]);

            const resolveCapacityProjectName = (key) => {
                if (!key) return '';
                const p = jiraProjects.find(p => p.key === key);
                return p ? p.name : '';
            };

            const capacityProjectSearchResults = React.useMemo(() => {
                const query = capacityProjectSearchQuery.toLowerCase().trim();
                if (!query) return [];
                return jiraProjects.filter(p => {
                    return p.key.toLowerCase().includes(query) || p.name.toLowerCase().includes(query);
                }).slice(0, 10);
            }, [capacityProjectSearchQuery, jiraProjects]);

            React.useEffect(() => {
                if (capacityProjectSearchIndex >= capacityProjectSearchResults.length) setCapacityProjectSearchIndex(0);
            }, [capacityProjectSearchResults.length]);

            const handleCapacityProjectSearchKeyDown = (event) => {
                if (event.key === 'ArrowDown') {
                    if (!capacityProjectSearchResults.length) return;
                    event.preventDefault();
                    setCapacityProjectSearchIndex(prev => Math.min(prev + 1, capacityProjectSearchResults.length - 1));
                } else if (event.key === 'ArrowUp') {
                    if (!capacityProjectSearchResults.length) return;
                    event.preventDefault();
                    setCapacityProjectSearchIndex(prev => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                    if (!capacityProjectSearchResults.length) return;
                    event.preventDefault();
                    const p = capacityProjectSearchResults[capacityProjectSearchIndex] || capacityProjectSearchResults[0];
                    if (p) { setCapacityProjectDraft(p.key); setCapacityProjectSearchQuery(''); setCapacityProjectSearchOpen(false); }
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setCapacityProjectSearchOpen(false);
                }
            };

            const capacityFieldSearchResults = React.useMemo(() => {
                const query = capacityFieldSearchQuery.toLowerCase().trim();
                if (!query) return jiraFields.slice(0, 20);
                return jiraFields.filter(f => {
                    return f.id.toLowerCase().includes(query) || f.name.toLowerCase().includes(query);
                }).slice(0, 20);
            }, [capacityFieldSearchQuery, jiraFields]);

            React.useEffect(() => {
                if (capacityFieldSearchIndex >= capacityFieldSearchResults.length) setCapacityFieldSearchIndex(0);
            }, [capacityFieldSearchResults.length]);

            const handleCapacityFieldSearchKeyDown = (event) => {
                if (event.key === 'ArrowDown') {
                    if (!capacityFieldSearchResults.length) return;
                    event.preventDefault();
                    setCapacityFieldSearchIndex(prev => Math.min(prev + 1, capacityFieldSearchResults.length - 1));
                } else if (event.key === 'ArrowUp') {
                    if (!capacityFieldSearchResults.length) return;
                    event.preventDefault();
                    setCapacityFieldSearchIndex(prev => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                    if (!capacityFieldSearchResults.length) return;
                    event.preventDefault();
                    const f = capacityFieldSearchResults[capacityFieldSearchIndex] || capacityFieldSearchResults[0];
                    if (f) { setCapacityFieldIdDraft(f.id); setCapacityFieldNameDraft(f.name); setCapacityFieldSearchQuery(''); setCapacityFieldSearchOpen(false); }
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setCapacityFieldSearchOpen(false);
                }
            };

            // --- Field picker search helpers (reuse jiraFields) ---
            const makeFieldSearchResults = (query, fields) => {
                const q = query.toLowerCase().trim();
                if (!q) return fields.slice(0, 20);
                return fields.filter(f => f.id.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)).slice(0, 20);
            };
            const makeFieldKeyDown = (results, indexState, setIndex, setId, setName, setQuery, setOpen) => (event) => {
                if (event.key === 'ArrowDown') {
                    if (!results.length) return;
                    event.preventDefault();
                    setIndex(prev => Math.min(prev + 1, results.length - 1));
                } else if (event.key === 'ArrowUp') {
                    if (!results.length) return;
                    event.preventDefault();
                    setIndex(prev => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                    if (!results.length) return;
                    event.preventDefault();
                    const f = results[indexState] || results[0];
                    if (f) { setId(f.id); setName(f.name); setQuery(''); setOpen(false); }
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                }
            };

            const sprintFieldSearchResults = React.useMemo(() => makeFieldSearchResults(sprintFieldSearchQuery, jiraFields), [sprintFieldSearchQuery, jiraFields]);
            React.useEffect(() => { if (sprintFieldSearchIndex >= sprintFieldSearchResults.length) setSprintFieldSearchIndex(0); }, [sprintFieldSearchResults.length]);
            const handleSprintFieldSearchKeyDown = makeFieldKeyDown(sprintFieldSearchResults, sprintFieldSearchIndex, setSprintFieldSearchIndex, setSprintFieldIdDraft, setSprintFieldNameDraft, setSprintFieldSearchQuery, setSprintFieldSearchOpen);

            const parentNameFieldSearchResults = React.useMemo(() => makeFieldSearchResults(parentNameFieldSearchQuery, jiraFields), [parentNameFieldSearchQuery, jiraFields]);
            React.useEffect(() => { if (parentNameFieldSearchIndex >= parentNameFieldSearchResults.length) setParentNameFieldSearchIndex(0); }, [parentNameFieldSearchResults.length]);
            const handleParentNameFieldSearchKeyDown = makeFieldKeyDown(parentNameFieldSearchResults, parentNameFieldSearchIndex, setParentNameFieldSearchIndex, setParentNameFieldIdDraft, setParentNameFieldNameDraft, setParentNameFieldSearchQuery, setParentNameFieldSearchOpen);

            const storyPointsFieldSearchResults = React.useMemo(() => makeFieldSearchResults(storyPointsFieldSearchQuery, jiraFields), [storyPointsFieldSearchQuery, jiraFields]);
            React.useEffect(() => { if (storyPointsFieldSearchIndex >= storyPointsFieldSearchResults.length) setStoryPointsFieldSearchIndex(0); }, [storyPointsFieldSearchResults.length]);
            const handleStoryPointsFieldSearchKeyDown = makeFieldKeyDown(storyPointsFieldSearchResults, storyPointsFieldSearchIndex, setStoryPointsFieldSearchIndex, setStoryPointsFieldIdDraft, setStoryPointsFieldNameDraft, setStoryPointsFieldSearchQuery, setStoryPointsFieldSearchOpen);

            const teamFieldSearchResults = React.useMemo(() => makeFieldSearchResults(teamFieldSearchQuery, jiraFields), [teamFieldSearchQuery, jiraFields]);
            React.useEffect(() => { if (teamFieldSearchIndex >= teamFieldSearchResults.length) setTeamFieldSearchIndex(0); }, [teamFieldSearchResults.length]);
            const handleTeamFieldSearchKeyDown = makeFieldKeyDown(teamFieldSearchResults, teamFieldSearchIndex, setTeamFieldSearchIndex, setTeamFieldIdDraft, setTeamFieldNameDraft, setTeamFieldSearchQuery, setTeamFieldSearchOpen);

            const exportGroupsConfig = async () => {
                const source = groupDraft || groupsConfig;
                const payload = {
                    version: source.version || 1,
                    groups: source.groups || [],
                    defaultGroupId: source.defaultGroupId || '',
                };
                const json = JSON.stringify(payload, null, 2);
                if (navigator.clipboard && window.isSecureContext) {
                    try {
                        await navigator.clipboard.writeText(json);
                        return;
                    } catch (err) {
                        // fallback below
                    }
                }
                const temp = document.createElement('textarea');
                temp.value = json;
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                document.body.removeChild(temp);
            };

            const importGroupsConfig = () => {
                if (!groupImportText.trim()) return;
                try {
                    const parsed = JSON.parse(groupImportText);
                    const normalized = normalizeGroupsConfig(parsed);
                    if (!normalized.groups.length) {
                        throw new Error('Imported config has no groups.');
                    }
                    // If imported JSON contains a teamCatalog, save it separately
                    const rawCatalog = parsed?.teamCatalog;
                    if (rawCatalog && typeof rawCatalog === 'object' && Object.keys(rawCatalog).length) {
                        const catalogEntries = {};
                        Object.entries(rawCatalog).forEach(([key, value]) => {
                            if (value && typeof value === 'object' && value.id && value.name) {
                                catalogEntries[String(value.id)] = { id: String(value.id), name: String(value.name) };
                            }
                        });
                        if (Object.keys(catalogEntries).length) {
                            saveTeamCatalog(catalogEntries, parsed?.teamCatalogMeta || {}, false);
                        }
                    }
                    setGroupDraft(normalized);
                    setGroupDraftError('');
                    setGroupImportText('');
                    setShowGroupImport(false);
                } catch (err) {
                    setGroupDraftError(err.message || 'Invalid JSON.');
                }
            };

            const teamNameLookup = React.useMemo(() => {
                const map = {};
                (availableTeams || []).forEach(team => {
                    if (team?.id) {
                        map[team.id] = team.name || team.id;
                    }
                });
                const catalog = teamCatalogState?.catalog || {};
                Object.entries(catalog).forEach(([teamId, entry]) => {
                    if (!map[teamId] && entry?.name) {
                        map[teamId] = entry.name;
                    }
                });
                return map;
            }, [availableTeams, teamCatalogState]);

            const resolveTeamName = (teamId) => {
                return teamNameLookup[teamId] || teamId;
            };

            const activeGroupDraft = React.useMemo(() => {
                if (!groupDraft || !activeGroupDraftId) return null;
                return (groupDraft.groups || []).find(group => group.id === activeGroupDraftId) || null;
            }, [groupDraft, activeGroupDraftId]);

            const filteredGroupDrafts = React.useMemo(() => {
                const groups = groupDraft?.groups || [];
                const query = groupSearchQuery.trim().toLowerCase();
                if (!query) return groups;
                return groups.filter(group => {
                    const nameMatch = String(group.name || '').toLowerCase().includes(query);
                    if (nameMatch) return true;
                    return (group.teamIds || []).some(teamId => {
                        const teamName = String(teamNameLookup[teamId] || teamId || '').toLowerCase();
                        return teamName.includes(query);
                    });
                });
            }, [groupDraft, groupSearchQuery, teamNameLookup]);

            const teamCacheMeta = React.useMemo(() => {
                return teamCatalogState?.meta || {};
            }, [teamCatalogState]);

            const teamCacheLabel = React.useMemo(() => {
                const stamp = teamCacheMeta?.updatedAt ? new Date(teamCacheMeta.updatedAt) : null;
                const formatted = stamp && !Number.isNaN(stamp.getTime()) ? stamp.toLocaleString() : '';
                if (!formatted) {
                    return `Teams: Not cached • ${availableTeams.length} available`;
                }
                return `Teams: Cached • ${availableTeams.length} available • Updated ${formatted}`;
            }, [teamCacheMeta, availableTeams]);

            const activeTeamQuery = activeGroupDraft ? (teamSearchQuery[activeGroupDraft.id] || '') : '';
            const activeTeamResults = React.useMemo(() => {
                if (!activeGroupDraft) return [];
                return getGroupTeamSearchResults(activeGroupDraft, activeTeamQuery);
            }, [activeGroupDraft, activeTeamQuery, availableTeams, groupDraft]);
            const activeTeamResultsLimited = activeTeamResults.slice(0, 10);
            const activeTeamIndex = activeGroupDraft ? (teamSearchIndex[activeGroupDraft.id] || 0) : 0;
            useEffect(() => {
                if (!showGroupManage) return;
                if (groupManageTab === 'epm') {
                    if (!canEditEpmConfiguration) {
                        setGroupManageTab('teams');
                    }
                    return;
                }
                if (!canEditSharedConfiguration && SHARED_CONFIGURATION_TAB_IDS.has(groupManageTab)) {
                    setGroupManageTab('teams');
                }
            }, [showGroupManage, canEditSharedConfiguration, canEditEpmConfiguration, groupManageTab]);
            useEffect(() => {
                if (ADMIN_SETTINGS_TAB_IDS.has(groupManageTab)) {
                    setAdminSettingsTab(groupManageTab);
                }
                if (DEPARTMENT_SETTINGS_TAB_IDS.has(groupManageTab)) {
                    setDepartmentSettingsTab(groupManageTab);
                }
            }, [groupManageTab]);
            const getLabelRowKey = (groupId, teamId) => `${groupId || 'group'}::${teamId || 'team'}`;
            const getLabelSearchResults = (groupId, teamId) => {
                const key = getLabelRowKey(groupId, teamId);
                const query = String(labelSearchQuery[key] || '').trim();
                if (query.length < 3) return [];
                return labelSearchResults[key] || [];
            };
            const selectTeamLabel = React.useCallback((groupId, teamId, label) => {
                const key = getLabelRowKey(groupId, teamId);
                setTeamLabelForGroup(groupId, teamId, label);
                setLabelSearchQuery(prev => ({ ...prev, [key]: '' }));
                setLabelSearchResults(prev => ({ ...prev, [key]: [] }));
                setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
                setLabelSearchOpen(prev => ({ ...prev, [key]: false }));
            }, [setTeamLabelForGroup]);
            const handleLabelSearchKeyDown = React.useCallback((groupId, teamId, event, results) => {
                const key = getLabelRowKey(groupId, teamId);
                if (event.key === 'ArrowDown') {
                    if (!results.length) return;
                    event.preventDefault();
                    setLabelSearchOpen(prev => ({ ...prev, [key]: true }));
                    setLabelSearchIndex(prev => ({
                        ...prev,
                        [key]: Math.min((prev[key] || 0) + 1, results.length - 1)
                    }));
                    return;
                }
                if (event.key === 'ArrowUp') {
                    if (!results.length) return;
                    event.preventDefault();
                    setLabelSearchOpen(prev => ({ ...prev, [key]: true }));
                    setLabelSearchIndex(prev => ({
                        ...prev,
                        [key]: Math.max((prev[key] || 0) - 1, 0)
                    }));
                    return;
                }
                if (event.key === 'Enter') {
                    if (!results.length) return;
                    event.preventDefault();
                    const index = labelSearchIndex[key] || 0;
                    const label = results[index] || results[0];
                    if (label) {
                        selectTeamLabel(groupId, teamId, label);
                    }
                    return;
                }
                if (event.key === 'Escape' && labelSearchOpen[key]) {
                    event.preventDefault();
                    event.stopPropagation();
                    setLabelSearchOpen(prev => ({ ...prev, [key]: false }));
                }
            }, [labelSearchIndex, labelSearchOpen, selectTeamLabel]);
            const loadJiraLabels = React.useCallback(async (groupId, teamId, rawQuery) => {
                const query = String(rawQuery || '').trim();
                const key = getLabelRowKey(groupId, teamId);
                if (query.length < 3) {
                    setLabelSearchResults(prev => ({ ...prev, [key]: [] }));
                    setLabelSearchLoading(prev => ({ ...prev, [key]: false }));
                    setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
                    return;
                }
                const cacheKey = query.toLowerCase();
                if (labelSearchCacheRef.current[cacheKey]) {
                    setLabelSearchResults(prev => ({ ...prev, [key]: labelSearchCacheRef.current[cacheKey] }));
                    setLabelSearchLoading(prev => ({ ...prev, [key]: false }));
                    setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
                    return;
                }
                const requestId = (labelSearchRequestIdRef.current[key] || 0) + 1;
                labelSearchRequestIdRef.current[key] = requestId;
                setLabelSearchLoading(prev => ({ ...prev, [key]: true }));
                try {
                    const payload = await requestJiraLabels(BACKEND_URL, { query, limit: 20 });
                    const nextResults = Array.isArray(payload.labels) ? payload.labels : [];
                    labelSearchCacheRef.current[cacheKey] = nextResults;
                    if (labelSearchRequestIdRef.current[key] === requestId) {
                        setLabelSearchResults(prev => ({ ...prev, [key]: nextResults }));
                        setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
                    }
                } catch (error) {
                    if (labelSearchRequestIdRef.current[key] === requestId) {
                        setLabelSearchResults(prev => ({ ...prev, [key]: [] }));
                        setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
                    }
                } finally {
                    if (labelSearchRequestIdRef.current[key] === requestId) {
                        setLabelSearchLoading(prev => ({ ...prev, [key]: false }));
                    }
                }
            }, []);
            const scheduleJiraLabelSearch = React.useCallback((groupId, teamId, rawQuery) => {
                const query = String(rawQuery || '').trim();
                const key = getLabelRowKey(groupId, teamId);
                const existingTimer = labelSearchDebounceRef.current[key];
                if (existingTimer) {
                    window.clearTimeout(existingTimer);
                    delete labelSearchDebounceRef.current[key];
                }
                if (query.length < 3) {
                    loadJiraLabels(groupId, teamId, query);
                    return;
                }
                labelSearchDebounceRef.current[key] = window.setTimeout(() => {
                    delete labelSearchDebounceRef.current[key];
                    loadJiraLabels(groupId, teamId, query);
                }, 250);
            }, [loadJiraLabels]);

            useEffect(() => {
                return () => {
                    Object.values(labelSearchDebounceRef.current).forEach((timerId) => {
                        window.clearTimeout(timerId);
                    });
                    labelSearchDebounceRef.current = {};
                };
            }, []);

            useEffect(() => {
                if (!activeGroupDraft) return;
                const maxIndex = activeTeamResultsLimited.length - 1;
                setTeamSearchIndex(prev => {
                    const current = prev[activeGroupDraft.id] || 0;
                    if (current <= maxIndex) return prev;
                    return { ...prev, [activeGroupDraft.id]: 0 };
                });
            }, [activeTeamResultsLimited.length, activeGroupDraft]);

            const matchesScenarioSearch = (issue, query) => {
                if (!query) return true;
                const assigneeValue = issue?.assignee?.displayName || issue?.assignee?.name || issue?.assignee;
                const teamValue = issue?.team?.name || issue?.team;
                const tokens = [
                    issue?.summary,
                    issue?.key,
                    issue?.epicKey,
                    issue?.epicSummary,
                    teamValue,
                    assigneeValue
                ]
                    .filter(Boolean)
                    .map(value => String(value).toLowerCase());
                return tokens.some(value => value.includes(query));
            };

            const registerScenarioIssueRef = (issueKey) => (node) => {
                const map = scenarioIssueRefMap.current;
                if (node) {
                    map.set(issueKey, node);
                } else {
                    map.delete(issueKey);
                }
            };

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
                return (groupsConfig.groups || []).find(group => group.id === activeGroupId) || null;
            }, [groupsConfig, activeGroupId]);
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

            const activeGroupTeamSet = React.useMemo(() => new Set(activeGroupTeamIds), [activeGroupTeamIds]);
            const planningScopeKey = React.useMemo(() => {
                if (selectedSprint === null || !activeGroupId) return '';
                return buildPlanningScopeKey({ sprintId: selectedSprint, groupId: activeGroupId });
            }, [selectedSprint, activeGroupId]);
            const teamSelectionScopeKey = React.useMemo(() => {
                if (selectedSprint === null || !activeGroupId) return '';
                return buildTeamSelectionScopeKey({ sprintId: selectedSprint, groupId: activeGroupId });
            }, [selectedSprint, activeGroupId]);
            const selectedTaskMapFromKeys = (keys) => {
                const next = {};
                (keys || []).forEach((key) => {
                    const normalizedKey = String(key || '').trim();
                    if (normalizedKey) {
                        next[normalizedKey] = true;
                    }
                });
                return next;
            };

            const buildDefaultGroupState = (groupId) => {
                const hasStoredPlanningState = planningScopeKey
                    ? hasPlanningState(window.localStorage, planningScopeKey)
                    : false;
                const planningState = planningScopeKey
                    ? loadPlanningState(window.localStorage, planningScopeKey)
                    : null;
                const selectedTeamsFromPlanning = resolvePlanningTeamSelection({
                    scopedState: hasStoredPlanningState ? planningState : null,
                    liveSelectedTeams: selectedTeams,
                    savedPrefsSelectedTeams: savedPrefsRef.current.selectedTeams,
                    savedPrefsSelectedTeam: savedPrefsRef.current.selectedTeam
                });
                const selectedTasksFromPlanning = hasStoredPlanningState
                    ? selectedTaskMapFromKeys(planningState?.selectedTaskKeys || [])
                    : {};
                return {
                    sprintId: selectedSprint,
                    teamIdsSignature: activeGroupTeamIds.join('|'),
                    productTasks: [],
                    techTasks: [],
                    loadedProductTasks: [],
                    loadedTechTasks: [],
                    tasksFetched: false,
                    readyToCloseProductTasks: [],
                    readyToCloseTechTasks: [],
                    missingPlanningInfoTasks: [],
                    missingInfoEpics: [],
                    productEpicsInScope: [],
                    techEpicsInScope: [],
                    readyToCloseProductEpicsInScope: [],
                    readyToCloseTechEpicsInScope: [],
                    techLoaded: false,
                    error: '',
                    showKilled: savedPrefsRef.current.showKilled ?? false,
                    showDone: savedPrefsRef.current.showDone ?? true,
                    showTech: savedPrefsRef.current.showTech ?? true,
                    showProduct: savedPrefsRef.current.showProduct ?? true,
                    statusFilter: savedPrefsRef.current.statusFilter ?? null,
                    searchQuery: savedPrefsRef.current.searchQuery ?? '',
                    selectedTeams: selectedTeamsFromPlanning,
                    selectedTasks: selectedTasksFromPlanning,
                    showPlanning: savedPrefsRef.current.showPlanning ?? false,
                    showStats: savedPrefsRef.current.showStats ?? false,
                    showScenario: false,
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
                    cohortGroupBy: resolveCohortGroupBy(savedPrefsRef.current.cohortGroupBy),
                    cohortProjectFilter: savedPrefsRef.current.cohortProjectFilter || 'all',
                    cohortAssigneeFilter: savedPrefsRef.current.cohortAssigneeFilter || 'all',
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
                    scenarioData: null,
                    scenarioError: '',
                    scenarioLaneMode: savedPrefsRef.current.scenarioLaneMode ?? 'team',
                    scenarioCollapsedLanes: {},
                    scenarioEpicFocus: null,
                    scenarioRangeOverride: null,
                    scenarioScrollTop: 0,
                    scenarioScrollLeft: 0,
                    scenarioViewportHeight: 0,
                    scenarioHoverKey: null,
                    scenarioFlashKey: null,
                    scenarioLayout: { width: 0, height: 0 },
                    scenarioEdgeRender: { width: 0, height: 0, paths: [] },
                    scenarioTooltip: {
                        visible: false,
                        x: 0,
                        y: 0,
                        summary: '',
                        key: '',
                        sp: null,
                        note: '',
                        assignee: null,
                        team: null
                    },
                    excludedStatsEpics: savedPrefsRef.current.excludedStatsEpics ?? [],
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
                teamIdsSignature: activeGroupTeamIds.join('|'),
                productTasks,
                techTasks,
                loadedProductTasks,
                loadedTechTasks,
                tasksFetched,
                readyToCloseProductTasks,
                readyToCloseTechTasks,
                missingPlanningInfoTasks,
                missingInfoEpics,
                productEpicsInScope,
                techEpicsInScope,
                readyToCloseProductEpicsInScope,
                readyToCloseTechEpicsInScope,
                techLoaded,
                error,
                showKilled,
                showDone,
                showTech,
                showProduct,
                statusFilter,
                searchQuery,
                selectedTeams,
                selectedTasks,
                showPlanning,
                showStats,
                showScenario,
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
                cohortGroupBy,
                cohortProjectFilter,
                cohortAssigneeFilter,
                cohortExcludeCapacity,
                cohortStatusToggles,
                cohortSelectedRow,
                scenarioData,
                scenarioError,
                scenarioLaneMode,
                scenarioCollapsedLanes,
                scenarioEpicFocus,
                scenarioRangeOverride,
                scenarioScrollTop,
                scenarioScrollLeft,
                scenarioViewportHeight,
                scenarioHoverKey,
                scenarioFlashKey,
                scenarioLayout,
                scenarioEdgeRender,
                scenarioTooltip,
                excludedStatsEpics,
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
                scenarioIssueRefMap.current.clear();
                scenarioEdgeUpdatePendingRef.current = false;
                scenarioFocusRestoreRef.current = null;
                scenarioSkipAutoCollapseRef.current = false;
                scenarioTeamCollapseInitRef.current = false;
                if (scenarioEdgeFrameRef.current) {
                    window.cancelAnimationFrame(scenarioEdgeFrameRef.current);
                    scenarioEdgeFrameRef.current = null;
                }
                alertDismissedRef.current = false;
                if (scenarioScrollFrameRef.current) {
                    window.cancelAnimationFrame(scenarioScrollFrameRef.current);
                    scenarioScrollFrameRef.current = null;
                }
                if (scenarioResizeFrameRef.current) {
                    window.cancelAnimationFrame(scenarioResizeFrameRef.current);
                    scenarioResizeFrameRef.current = null;
                }
                scenarioPendingScrollRef.current = null;
                epicRefMap.current = new Map();
                setProductTasks(nextState.productTasks || []);
                setTechTasks(nextState.techTasks || []);
                setLoadedProductTasks(nextState.loadedProductTasks || []);
                setLoadedTechTasks(nextState.loadedTechTasks || []);
                setTasksFetched(Boolean(nextState.tasksFetched));
                setReadyToCloseProductTasks(nextState.readyToCloseProductTasks || []);
                setReadyToCloseTechTasks(nextState.readyToCloseTechTasks || []);
                setMissingPlanningInfoTasks(nextState.missingPlanningInfoTasks || []);
                setMissingInfoEpics(nextState.missingInfoEpics || []);
                setProductEpicsInScope(nextState.productEpicsInScope || []);
                setTechEpicsInScope(nextState.techEpicsInScope || []);
                setReadyToCloseProductEpicsInScope(nextState.readyToCloseProductEpicsInScope || []);
                setReadyToCloseTechEpicsInScope(nextState.readyToCloseTechEpicsInScope || []);
                setTechLoaded(Boolean(nextState.techLoaded));
                setError(nextState.error || '');
                setShowKilled(nextState.showKilled ?? false);
                setShowDone(nextState.showDone ?? true);
                setShowTech(nextState.showTech ?? true);
                setShowProduct(nextState.showProduct ?? true);
                setStatusFilter(nextState.statusFilter ?? null);
                setSearchQuery(nextState.searchQuery ?? '');
                setSelectedTeams(normalizeSelectedTeams(nextState.selectedTeams));
                setSelectedTasks(nextState.selectedTasks || {});
                setShowPlanning(nextState.showPlanning ?? false);
                setShowStats(nextState.showStats ?? false);
                setShowScenario(nextState.showScenario ?? false);
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
                setCohortGroupBy(resolveCohortGroupBy(nextState.cohortGroupBy));
                setCohortProjectFilter(nextState.cohortProjectFilter || 'all');
                setCohortAssigneeFilter(nextState.cohortAssigneeFilter || 'all');
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
                setScenarioData(nextState.scenarioData || null);
                setScenarioError(nextState.scenarioError || '');
                setScenarioLaneMode(nextState.scenarioLaneMode || 'team');
                setScenarioCollapsedLanes(nextState.scenarioCollapsedLanes || {});
                setScenarioEpicFocus(nextState.scenarioEpicFocus || null);
                setScenarioRangeOverride(nextState.scenarioRangeOverride || null);
                setScenarioScrollTop(nextState.scenarioScrollTop || 0);
                setScenarioScrollLeft(nextState.scenarioScrollLeft || 0);
                setScenarioViewportHeight(nextState.scenarioViewportHeight || 0);
                setScenarioHoverKey(nextState.scenarioHoverKey || null);
                setScenarioFlashKey(nextState.scenarioFlashKey || null);
                setScenarioLayout(nextState.scenarioLayout || { width: 0, height: 0 });
                setScenarioEdgeRender(nextState.scenarioEdgeRender || { width: 0, height: 0, paths: [] });
                setScenarioTooltip(nextState.scenarioTooltip || {
                    visible: false,
                    x: 0,
                    y: 0,
                    summary: '',
                    key: '',
                    sp: null,
                    note: '',
                    assignee: null,
                    team: null
                });
                setExcludedStatsEpics(nextState.excludedStatsEpics || []);
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
                setScenarioLoading(false);
                window.setTimeout(() => {
                    restoringGroupRef.current = false;
                }, 0);
            };

            const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), [
                selectedSprint, missingInfoEpics,
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
                showKilled,
                showDone,
                showTech,
                showProduct,
                statusFilter,
                searchQuery,
                selectedTeams,
                selectedTasks,
                showPlanning,
                showStats,
                showScenario,
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
                cohortGroupBy,
                cohortProjectFilter,
                cohortAssigneeFilter,
                cohortExcludeCapacity,
                cohortStatusToggles,
                cohortSelectedRow,
                scenarioData,
                scenarioError,
                scenarioLaneMode,
                scenarioCollapsedLanes,
                scenarioEpicFocus,
                scenarioRangeOverride,
                scenarioScrollTop,
                scenarioScrollLeft,
                scenarioViewportHeight,
                scenarioHoverKey,
                scenarioFlashKey,
                scenarioLayout,
                scenarioEdgeRender,
                scenarioTooltip,
                excludedStatsEpics,
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
                groupStateRef.current.set(activeGroupId, groupStateSnapshot);
            }, [activeGroupId, groupStateSnapshot]);

            useEffect(() => {
                if (!activeGroupId) return;
                if (activeGroupRef.current === activeGroupId) return;
                activeGroupRef.current = activeGroupId;
                const cached = groupStateRef.current.get(activeGroupId);
                const matchesScope = cached &&
                    cached.sprintId === selectedSprint &&
                    cached.teamIdsSignature === activeGroupTeamIds.join('|');
                if (matchesScope) {
                    applyGroupState(cached);
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
                if (cached && cached.sprintId === selectedSprint && cached.teamIdsSignature === activeGroupTeamIds.join('|')) {
                    planningHydratedScopeRef.current = planningScopeKey;
                    return;
                }
                const fallback = buildDefaultGroupState(activeGroupId);
                groupStateRef.current.set(activeGroupId, fallback);
                applyGroupState(fallback);
                planningHydratedScopeRef.current = planningScopeKey;
            }, [planningScopeKey, activeGroupId, selectedSprint, activeGroupTeamIds.join('|')]);


            useEffect(() => {
                if (!showPlanning) {
                    setPlanningOffset(0);
                }
            }, [showPlanning]);

            useEffect(() => {
                if (showPlanning) {
                    setShowStats(false);
                    setShowScenario(false);
                }
            }, [showPlanning]);

            useEffect(() => {
                if (showPlanning && isCompletedSprintSelected) {
                    setShowPlanning(false);
                }
            }, [showPlanning, isCompletedSprintSelected]);

            useEffect(() => {
                if (showPlanning && !isCompletedSprintSelected) {
                    includePlanningTasksByStatus(['Accepted', 'In Progress']);
                }
            }, [showPlanning, isCompletedSprintSelected]);

            useEffect(() => {
                if (!selectedSprint) return;
                if (!showSprintDropdown) return;
                const dropdownNode = getActiveDropdownNode(sprintDropdownRefs);
                const optionEl = dropdownNode?.querySelector(`[data-sprint-id="${selectedSprint}"]`);
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
            }, [showSprintDropdown, selectedSprint, filteredSprints?.length, compactStickyVisible]);

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
                if (showStats) {
                    setShowPlanning(false);
                    setShowScenario(false);
                }
            }, [showStats]);

            useEffect(() => {
                if (showScenario) {
                    setShowPlanning(false);
                    setShowStats(false);
                }
            }, [showScenario]);

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
                if (!capacityEnabled) {
                    setCapacityByTeam({});
                }
            }, [capacityEnabled]);

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
                const handle = window.setTimeout(() => {
                    setSearchQuery(searchInput);
                }, 200);
                return () => window.clearTimeout(handle);
            }, [searchInput]);

            useEffect(() => {
                const handleKey = (event) => {
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

            useEffect(() => () => {
                if (searchFocusReleaseTimeoutRef.current) {
                    window.clearTimeout(searchFocusReleaseTimeoutRef.current);
                }
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
                    selectedSprint,
                    selectedTeams,
                    activeGroupId,
                    showPlanning,
                    showStats,
                    showScenario,
                    showDependencies,
                    showTech,
                    showProduct,
                    showDone,
                    showKilled,
                    statusFilter,
                    searchQuery,
                    statsView,
                    statsGraphMode,
                    burnoutAssigneeFilter,
                    burndownMetric,
                    cohortStartQuarter,
                    cohortGroupBy,
                    cohortProjectFilter,
                    cohortAssigneeFilter,
                    cohortExcludeCapacity,
                    cohortStatusToggles,
                    excludedCapacityStartSprintId,
                    excludedCapacityEndSprintId,
                    excludedCapacitySelectedEpicKeys,
                    excludedCapacityChartMode,
                    excludedCapacityMetric,
                    scenarioLaneMode,
                    excludedStatsEpics,
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
                    updateDismissedHash
                });
            }, [
                selectedView,
                epmTab,
                epmSelectedProjectId,
                selectedSprint,
                selectedTeams,
                activeGroupId,
                showPlanning,
                showStats,
                showScenario,
                showDependencies,
                showTech,
                showProduct,
                showDone,
                showKilled,
                statusFilter,
                searchQuery,
                statsView,
                statsGraphMode,
                burnoutAssigneeFilter,
                burndownMetric,
                cohortStartQuarter,
                cohortGroupBy,
                cohortProjectFilter,
                cohortAssigneeFilter,
                cohortExcludeCapacity,
                cohortStatusToggles,
                excludedCapacityStartSprintId,
                excludedCapacityEndSprintId,
                excludedCapacitySelectedEpicKeys,
                excludedCapacityChartMode,
                excludedCapacityMetric,
                scenarioLaneMode,
                excludedStatsEpics,
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
                updateDismissedHash
            ]);

            const loadConfig = async () => {
                try {
                    const config = await fetchAppConfig(BACKEND_URL);
                    clearServerConnectionError();
                    setJiraUrl(config.jiraUrl || '');
                    setAuthMode(config.authMode || '');
                    setCapacityEnabled(Boolean(config.capacityProject));
                    setGroupQueryTemplateEnabled(Boolean(config.groupQueryTemplateEnabled));
                    setSettingsAdminOnly(Boolean(config.settingsAdminOnly));
                    setUserCanEditSettings(config.userCanEditSettings === true);
                    setUserCanEditEpmConfig(config.userCanEditEpmConfig === true);
                    setEnvironmentConfigExists(Boolean(config.environmentConfigExists || config.projectsConfigured));
                    applySavedEpmConfig(config.epm);
                } catch (err) {
                    if (!reportServerConnectionError(err)) {
                        console.error('Failed to load config:', err);
                    }
                    applySavedEpmConfig(createEmptyEpmConfigDraft());
                }
            };

            useEffect(() => {
                if (selectedView !== 'eng') return;
                if (isStatsSourceOnlyStatsView) return;
                // Load tasks when sprint changes (team is filtered client-side)
                if (selectedSprint === null) {
                    return;
                }

                // Wait for groups config to load before loading tasks
                if (groupsLoading) {
                    return;
                }

                const forceConfigRefresh =
                    configRefreshNonce !== 0 &&
                    pendingConfigRefreshRef.current === configRefreshNonce;

                // Only skip loading if we have actual cached data
                const shouldSkipLoad = !forceConfigRefresh && activeGroupId && (() => {
                    const cached = groupStateRef.current.get(activeGroupId);
                    return cached &&
                        cached.sprintId === selectedSprint &&
                        cached.teamIdsSignature === activeGroupTeamIds.join('|') &&
                        cached.tasksFetched &&
                        lastLoadedSprintRef.current === selectedSprint &&
                        (cached.productTasks?.length > 0 || cached.techTasks?.length > 0);
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
                loadProductTasks();
                loadTechTasks();
                fetchMissingPlanningInfo(selectedSprint);
            }, [selectedView, isStatsSourceOnlyStatsView, selectedSprint, activeGroupId, activeGroupTeamIds.join('|'), groupsLoading, (activeGroup?.missingInfoComponents || []).join(','), configRefreshNonce]);

            useEffect(() => {
                if (!isStatsSourceOnlyStatsView) return;
                abortSprintFetches();
            }, [isStatsSourceOnlyStatsView, abortSprintFetches]);

            const fetchMissingPlanningInfo = async (sprintId) => {
                const controller = registerSprintFetch();
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
                        signal: controller.signal
                    });
	                    if (!response.ok) return;
	                    const data = await response.json();
	                    setMissingPlanningInfoTasks(data.issues || []);
	                    setMissingInfoEpics(data.epics || []);
	                } catch (e) {
                        if (e.name === 'AbortError') return;
	                    // ignore (alerts are best-effort)
	                } finally {
                        cleanupSprintFetch(controller);
                    }
	            };

            useEffect(() => {
                setTechLoaded(false);
            }, [selectedSprint]);

            useEffect(() => {
                epicOrderRef.current = {};
                epicOrderCounterRef.current = 0;
            }, [selectedSprint]);

            useEffect(() => {
                setScenarioData(null);
                setScenarioError('');
            }, [selectedSprint, selectedTeams]);


            const loadSprints = async (forceRefresh = false) => {
                setSprintsLoading(true);
                try {
                    const response = await requestSprints(BACKEND_URL, { forceRefresh });

                    if (!response.ok) {
                        throw new Error(`Error ${response.status}`);
                    }

                    const data = await response.json();
                    const sprints = data.sprints || [];
                    setAvailableSprints(sprints);

                    const preferredSprintId = savedPrefsRef.current.selectedSprint;
                    const preferredSprint = preferredSprintId ? sprints.find(s => String(s.id) === String(preferredSprintId)) : null;

                    if (preferredSprint) {
                        setSelectedSprint(preferredSprint.id);
                        setSprintName(preferredSprint.name);
                    } else {
                        // Auto-select current quarter if available
                        const currentQuarter = getCurrentQuarter();
                        const currentSprint = sprints.find(s => s.name === currentQuarter);
                        if (currentSprint) {
                            setSelectedSprint(currentSprint.id);
                            setSprintName(currentSprint.name);
                        } else if (sprints.length > 0) {
                            // If current quarter not found, select the last sprint
                            const lastSprint = sprints[sprints.length - 1];
                            setSelectedSprint(lastSprint.id);
                            setSprintName(lastSprint.name);
                        }
                    }

                    console.log('✅ Loaded sprints:', sprints);
                    clearServerConnectionError();
                } catch (err) {
                    if (!reportServerConnectionError(err)) {
                        console.error('Failed to load sprints:', err);
                        setError(`Failed to load sprints: ${err.message}`);
                    }
                } finally {
                    setSprintsLoading(false);
                }
            };

            const priorityOrder = PRIORITY_ORDER;

            const fetchCapacity = async (sprintName) => {
                if (!capacityEnabled || !sprintName) return;
                setCapacityLoading(true);
                try {
                    const teams = capacityTeamNames;
                    const response = await requestCapacity(BACKEND_URL, { sprintName, teams });
                    if (!response.ok) {
                        setCapacityByTeam({});
                        return;
                    }
                    const data = await response.json();
                    if (!data?.enabled) {
                        setCapacityByTeam({});
                        return;
                    }
                    const normalized = {};
                    Object.entries(data.capacities || {}).forEach(([name, value]) => {
                        const key = normalizeCapacityKey(name);
                        const numeric = Number(value);
                        if (!key || Number.isNaN(numeric)) return;
                        normalized[key] = numeric;
                    });
                    setCapacityByTeam(normalized);
                } catch (err) {
                    setCapacityByTeam({});
                } finally {
                    setCapacityLoading(false);
                }
            };

            const priorityAxis = PRIORITY_AXIS;

            const getTeamInfo = getTaskTeamInfo;

            const {
                fetchTasks,
                fetchBacklogEpics,
                loadProductTasks,
                loadTechTasks,
                loadReadyToCloseProductTasks,
                loadReadyToCloseTechTasks,
            } = useEngSprintData({
                backendUrl: BACKEND_URL,
                selectedSprint,
                activeGroupId,
                activeGroupTeamIds,
                activeGroupTeamSet,
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
            });

            const fetchDependencies = async (keys) => {
                if (!keys.length) {
                    setDependencyData({});
                    return;
                }
                const controller = registerSprintFetch();
                try {
                    const response = await requestDependencies(BACKEND_URL, keys, { signal: controller.signal });
                    if (!response.ok) {
                        console.error('Dependencies fetch failed:', response.status);
                        return;
                    }
                    const data = await response.json();
                    setDependencyData(data.dependencies || {});
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error('Dependencies fetch error:', err);
                } finally {
                    cleanupSprintFetch(controller);
                }
            };


            const normalizeScenarioDraftOverrides = (overrides) => {
                const normalized = {};
                Object.entries(overrides || {}).forEach(([issueKey, value]) => {
                    const key = String(issueKey || '').trim();
                    if (!key || !value || typeof value !== 'object') return;
                    const start = typeof value.start === 'string' ? value.start : '';
                    const end = typeof value.end === 'string' ? value.end : '';
                    if (!start && !end) return;
                    normalized[key] = { start, end };
                });
                return normalized;
            };

            const scenarioDraftOverridesSignature = (overrides) => {
                const normalized = normalizeScenarioDraftOverrides(overrides);
                return Object.keys(normalized)
                    .sort()
                    .map(key => `${key}:${normalized[key].start || ''}:${normalized[key].end || ''}`)
                    .join('|');
            };

            const fetchScenarioCsrfToken = () =>
                fetchCsrfToken(BACKEND_URL).then(({ csrfToken }) => csrfToken || '');

            const fetchScenarioDraft = async (scopeKey, signal) => {
                const response = await fetch(`${BACKEND_URL}/api/scenario/drafts?scope_key=${encodeURIComponent(scopeKey)}`, {
                    cache: 'no-cache',
                    signal
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || errorData.error || `Scenario draft error ${response.status}`);
                }
                return response.json();
            };

            const fetchScenarioRealtimeCsrfToken = async (forceRefresh = false) => {
                if (!forceRefresh && scenarioRealtimeCsrfRef.current) {
                    return scenarioRealtimeCsrfRef.current;
                }
                const token = await fetchScenarioCsrfToken();
                scenarioRealtimeCsrfRef.current = token;
                return token;
            };

            const pauseScenarioRealtime = (message) => {
                setScenarioDraftRealtimeStatus({
                    mode: 'paused',
                    paused: true,
                    message: message || 'Realtime paused; keep editing local-only until the session is refreshed.'
                });
            };

            const postScenarioRealtimeJson = async (draftId, path, payload) => {
                const postWithToken = async (csrfToken) => {
                    const response = await fetch(`${BACKEND_URL}/api/scenario/drafts/${encodeURIComponent(draftId)}${path}`, {
                        method: 'POST',
                        cache: 'no-cache',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Requested-With': 'jira-execution-planner',
                            'X-CSRF-Token': csrfToken
                        },
                        body: JSON.stringify(payload)
                    });
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        const error = new Error(errorData.message || errorData.error || `Scenario realtime error ${response.status}`);
                        error.payload = errorData;
                        error.status = response.status;
                        throw error;
                    }
                    return response.json();
                };
                try {
                    return await postWithToken(await fetchScenarioRealtimeCsrfToken(false));
                } catch (err) {
                    if (err.status === 403 && err.payload?.error === 'csrf_required') {
                        try {
                            return await postWithToken(await fetchScenarioRealtimeCsrfToken(true));
                        } catch (retryErr) {
                            pauseScenarioRealtime('Realtime paused; session security expired. Keep editing local-only, then refresh or sign in again.');
                            throw retryErr;
                        }
                    }
                    throw err;
                }
            };

            const mergeScenarioDraftPresence = (presence) => {
                if (!presence) return;
                const key = String(presence.userId || presence.presenceId || presence.displayName || '').trim();
                if (!key) return;
                setScenarioDraftPresence(prev => {
                    const next = prev.filter(item => String(item.userId || item.presenceId || item.displayName || '') !== key);
                    return [...next, presence];
                });
            };

            const mergeScenarioDraftLock = (lock) => {
                if (!lock) return;
                const resourceType = String(lock.resourceType || '').trim();
                const resourceId = String(lock.resourceId || '').trim();
                if (!resourceType || !resourceId) return;
                setScenarioDraftLocks(prev => {
                    const next = prev.filter(item => (
                        String(item.resourceType || '') !== resourceType
                        || String(item.resourceId || '') !== resourceId
                    ));
                    return [...next, lock];
                });
            };

            const learnScenarioCurrentUserFromPresence = (presence) => {
                if (!presence) return;
                setScenarioCurrentUserIdentity(prev => ({
                    userId: String(presence.userId || prev.userId || '').trim(),
                    displayName: String(presence.displayName || prev.displayName || '').trim()
                }));
            };

            const learnScenarioCurrentUserFromLock = (lock) => {
                if (!lock) return;
                setScenarioCurrentUserIdentity(prev => ({
                    userId: String(lock.holderUserId || prev.userId || '').trim(),
                    displayName: String(lock.holderDisplayName || prev.displayName || '').trim()
                }));
            };

            const SCENARIO_PRESENCE_TTL_MS = 30000;

            const isTimestampExpired = (value) => {
                if (!value) return false;
                const timestamp = Date.parse(value);
                return Number.isFinite(timestamp) && timestamp <= Date.now();
            };

            const isScenarioPresenceExpired = (presence) => {
                if (presence?.expiresAt) return isTimestampExpired(presence.expiresAt);
                if (!presence?.lastSeenAt) return false;
                const lastSeenAt = Date.parse(presence.lastSeenAt);
                return Number.isFinite(lastSeenAt) && lastSeenAt + SCENARIO_PRESENCE_TTL_MS <= Date.now();
            };

            const isScenarioLockExpired = (lock) => isTimestampExpired(lock?.expiresAt);

            const removeScenarioDraftLock = (resourceType, resourceId) => {
                const type = String(resourceType || '').trim();
                const id = String(resourceId || '').trim();
                if (!type || !id) return;
                setScenarioDraftLocks(prev => prev.filter(item => (
                    String(item.resourceType || '') !== type
                    || String(item.resourceId || '') !== id
                )));
            };

            const applyScenarioDraftEvent = (event) => {
                if (!event) return;
                const eventNumber = Number(event.eventNumber || 0);
                if (eventNumber > 0) {
                    setScenarioDraftLastEventNumber(prev => Math.max(prev, eventNumber));
                }
                setScenarioDraftEvents(prev => {
                    if (eventNumber && prev.some(item => Number(item.eventNumber || 0) === eventNumber)) {
                        return prev;
                    }
                    return [...prev, event].slice(-100);
                });
                const payload = event.payload || {};
                if (event.eventType === 'presence.updated') {
                    if (isScenarioPresenceExpired(payload.presence)) return;
                    mergeScenarioDraftPresence(payload.presence);
                    return;
                }
                if (event.eventType === 'lock.acquired' || event.eventType === 'lock.refreshed') {
                    if (isScenarioLockExpired(payload.lock)) {
                        removeScenarioDraftLock(payload.lock?.resourceType, payload.lock?.resourceId);
                        return;
                    }
                    mergeScenarioDraftLock(payload.lock);
                    return;
                }
                if (event.eventType === 'lock.released') {
                    removeScenarioDraftLock(payload.resourceType, payload.resourceId);
                    return;
                }
                const remoteDraftRevision = Number(event.draftRevision || payload.activeDraft?.draftRevision || 0);
                setScenarioDraftMeta(prev => {
                    const localBaseDraftRevision = Number(prev.baseDraftRevision || 0);
                    if (!remoteDraftRevision || remoteDraftRevision <= localBaseDraftRevision) {
                        return prev;
                    }
                    const nextVersions = Array.isArray(payload.versions) && payload.versions.length
                        ? payload.versions
                        : prev.versions;
                    return {
                        ...prev,
                        versions: nextVersions,
                        staleDraft: {
                            draftRevision: remoteDraftRevision,
                            eventNumber,
                            activeDraft: payload.activeDraft || null,
                            updatedBy: payload.activeDraft?.updatedBy || event.createdBy || ''
                        },
                        dirtyState: prev.dirtyState === 'clean' ? 'stale_remote' : prev.dirtyState,
                        message: '',
                        error: ''
                    };
                });
            };

            const pollScenarioDraftEvents = async (draftId, sinceEventNumber, signal) => {
                const response = await fetch(`${BACKEND_URL}/api/scenario/drafts/${encodeURIComponent(draftId)}/events?since=${encodeURIComponent(sinceEventNumber || 0)}`, {
                    cache: 'no-cache',
                    signal
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || errorData.error || `Scenario draft events error ${response.status}`);
                }
                const data = await response.json();
                return {
                    events: Array.isArray(data.events) ? data.events : [],
                    nextSince: Number(data.nextSince || 0)
                };
            };

            const saveScenarioDraftVersion = async (scopeKey, name, baseDraftRevision, scope, overrides) => {
                const payload = {
                    scope_key: scopeKey,
                    name,
                    baseDraftRevision,
                    scope,
                    scenarioOverrides: normalizeScenarioDraftOverrides(overrides),
                    overrides: normalizeScenarioDraftOverrides(overrides)
                };
                const postScenarioDraft = async (csrfToken) => {
                    const response = await fetch(`${BACKEND_URL}/api/scenario/drafts`, {
                        method: 'POST',
                        cache: 'no-cache',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Requested-With': 'jira-execution-planner',
                            'X-CSRF-Token': csrfToken
                        },
                        body: JSON.stringify(payload)
                    });
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        const error = new Error(errorData.message || errorData.error || `Scenario draft save error ${response.status}`);
                        error.payload = errorData;
                        error.status = response.status;
                        throw error;
                    }
                    return response.json();
                };
                const csrfToken = await fetchScenarioCsrfToken();
                try {
                    return await postScenarioDraft(csrfToken);
                } catch (err) {
                    if (err.status === 403 && err.payload?.error === 'csrf_required') {
                        const freshCsrfToken = await fetchScenarioCsrfToken();
                        try {
                            return await postScenarioDraft(freshCsrfToken);
                        } catch (csrfRetry) {
                            csrfRetry.message = 'Session security check expired. Try saving again.';
                            throw csrfRetry;
                        }
                    }
                    throw err;
                }
            };

            const fetchScenarioDraftVersion = async (draftId, versionNumber, signal) => {
                const response = await fetch(`${BACKEND_URL}/api/scenario/drafts/${encodeURIComponent(draftId)}/versions/${encodeURIComponent(versionNumber)}`, {
                    cache: 'no-cache',
                    signal
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || errorData.error || `Scenario draft version error ${response.status}`);
                }
                return response.json();
            };

            const rollbackScenarioDraft = async (draftId, targetVersionNumber, baseDraftRevision, signal) => {
                const csrfToken = await fetchScenarioCsrfToken();
                const response = await fetch(`${BACKEND_URL}/api/scenario/drafts/${encodeURIComponent(draftId)}/rollback`, {
                    method: 'POST',
                    cache: 'no-cache',
                    signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'jira-execution-planner',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({
                        targetVersionNumber,
                        baseDraftRevision
                    })
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const error = new Error(errorData.message || errorData.error || `Scenario draft rollback error ${response.status}`);
                    error.payload = errorData;
                    throw error;
                }
                return response.json();
            };

            const reloadScenarioDraftFromJira = async (draftId, baseDraftRevision, signal) => {
                const csrfToken = await fetchScenarioCsrfToken();
                const response = await fetch(`${BACKEND_URL}/api/scenario/drafts/${encodeURIComponent(draftId)}/reload-from-jira`, {
                    method: 'POST',
                    cache: 'no-cache',
                    signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'jira-execution-planner',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({
                        baseDraftRevision
                    })
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const error = new Error(errorData.message || errorData.error || `Scenario draft reload error ${response.status}`);
                    error.payload = errorData;
                    throw error;
                }
                return response.json();
            };

            const buildScenarioDraftScope = () => ({
                groupId: activeGroupId || '',
                groupName: activeGroup?.name || '',
                sprintId: selectedSprint ? String(selectedSprint) : '',
                sprintName: selectedSprintInfo?.name || ''
            });

            const buildScenarioPayload = () => {
                const isActiveSprint = selectedSprintState === 'active';
                const anchorDate = isActiveSprint
                    ? new Date().toISOString().slice(0, 10)
                    : null;
                return {
                    config: {
                        lane_mode: scenarioLaneMode,
                        anchor_date: anchorDate,
                        excluded_capacity_epics: Array.from(excludedEpicSet)
                    },
                    filters: {
                        sprint: selectedSprint || null,
                        teams: scenarioTeamIds
                    }
                };
            };

            const scenarioDraftIdleActionState = () => ({
                loadingVersionNumber: null,
                loadingActiveDraft: false,
                rollingBackVersionNumber: null,
                reloadingFromJira: false,
                pendingHistoryAction: null,
                pendingActiveDraftReload: false,
                pendingReloadFromJira: false,
                writebackPreviewing: false,
                writebackChecking: false,
                writebackPreview: null,
                writebackBlocked: null
            });

            const runScenario = async () => {
                if (!selectedSprint) {
                    setScenarioError('Select a sprint to build a scenario.');
                    return;
                }
                if (isCompletedSprintSelected) {
                    setScenarioError('Scenario planner is disabled for completed sprints.');
                    return;
                }
                if (scenarioHasUnsavedChanges) {
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        pendingScopeChange: { scopeKey: scenarioScopeKey },
                        error: ''
                    }));
                    setScenarioError('Save or discard scenario draft changes before reloading scenario data.');
                    return;
                }
                setScenarioLoading(true);
                setScenarioError('');
                const controller = registerSprintFetch();
                try {
                    const response = await fetch(`${BACKEND_URL}/api/scenario`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Requested-With': 'jira-execution-planner'
                        },
                        body: JSON.stringify(buildScenarioPayload()),
                        signal: controller.signal
                    });
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `Scenario error ${response.status}`);
                    }
                    const data = await response.json();
                    const scopePayload = buildScenarioDraftScope();
                    setScenarioOverrides({});
                    setScenarioDraftEvents([]);
                    setScenarioDraftPresence([]);
                    setScenarioDraftLocks([]);
                    setScenarioDraftLastEventNumber(0);
                    setScenarioDraftRealtimeStatus({ mode: 'idle', paused: false, message: '' });
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        activeDraft: null,
                        versions: [],
                        loadedVersionNumber: null,
                        baseDraftRevision: null,
                        savedOverrides: {},
                        scopePayload,
                        scopeKey: scenarioScopeKey,
                        dirtyState: 'clean',
                        pendingScopeChange: null,
                        loadingHistory: Boolean(scenarioScopeKey),
                        ...scenarioDraftIdleActionState(),
                        staleDraft: null,
                        conflict: null,
                        message: '',
                        error: ''
                    }));
                    setScenarioData(data);
                    // Reset scroll so stale content height doesn't leave empty space
                    if (scenarioTimelineRef.current) {
                        scenarioTimelineRef.current.scrollTop = 0;
                    }
                    // Load the active draft for this scope unless the user has dirty edits from another scope.
                    if (scenarioScopeKey) {
                        try {
                            const draftData = await fetchScenarioDraft(scenarioScopeKey, controller.signal);
                            const activeDraft = draftData.activeDraft || null;
                            const versions = Array.isArray(draftData.versions) ? draftData.versions : [];
                            if (activeDraft) {
                                const overrides = normalizeScenarioDraftOverrides(activeDraft.overrides || {});
                                setScenarioOverrides(overrides);
                                setScenarioDraftMeta(prev => ({
                                    ...prev,
                                    activeDraft,
                                    versions,
                                    loadedVersionNumber: activeDraft.versionNumber || null,
                                    baseDraftRevision: activeDraft.draftRevision || null,
                                    savedOverrides: overrides,
                                    scopePayload: activeDraft.scopePayload || scopePayload,
                                    scopeKey: scenarioScopeKey,
                                    dirtyState: 'clean',
                                    pendingScopeChange: null,
                                    loadingHistory: false,
                                    ...scenarioDraftIdleActionState(),
                                    staleDraft: null,
                                    conflict: null,
                                    message: '',
                                    error: ''
                                }));
                            } else {
                                setScenarioOverrides({});
                                setScenarioDraftMeta(prev => ({
                                    ...prev,
                                    activeDraft: null,
                                    versions,
                                    loadedVersionNumber: null,
                                    baseDraftRevision: null,
                                    savedOverrides: {},
                                    scopePayload,
                                    scopeKey: scenarioScopeKey,
                                    dirtyState: 'clean',
                                    pendingScopeChange: null,
                                    loadingHistory: false,
                                    ...scenarioDraftIdleActionState(),
                                    staleDraft: null,
                                    conflict: null,
                                    message: '',
                                    error: ''
                                }));
                            }
                        } catch (err) {
                            if (err.name === 'AbortError') throw err;
                            setScenarioOverrides({});
                            setScenarioDraftMeta(prev => ({
                                ...prev,
                                activeDraft: null,
                                versions: [],
                                loadedVersionNumber: null,
                                baseDraftRevision: null,
                                savedOverrides: {},
                                scopePayload,
                                scopeKey: scenarioScopeKey,
                                dirtyState: 'clean',
                                pendingScopeChange: null,
                                loadingHistory: false,
                                ...scenarioDraftIdleActionState(),
                                staleDraft: null,
                                conflict: null,
                                error: err.message || 'Failed to load scenario draft.'
                            }));
                        }
                    }
                } catch (err) {
                    if (err.name === 'AbortError') {
                        return;
                    }
                    setScenarioError(err.message || 'Failed to run scenario.');
                } finally {
                    cleanupSprintFetch(controller);
                    setScenarioLoading(false);
                }
            };

            const toggleScenarioEditMode = () => {
                setScenarioEditMode(prev => {
                    if (!prev) {
                        // Entering edit mode — clear epic focus (edit operates on flat bars)
                        setScenarioEpicFocus(null);
                    } else {
                        // Exiting edit mode — clear undo stack
                        scenarioUndoStackRef.current.clear();
                        setScenarioUndoVersion(0);
                    }
                    return !prev;
                });
            };

            const acquireScenarioIssueLock = async (issueKey) => {
                if (!scenarioActiveDraftReady || scenarioDraftRealtimeStatus.paused || !issueKey) return;
                try {
                    const data = await postScenarioRealtimeJson(scenarioActiveDraftId, '/locks', {
                        action: 'acquire',
                        resourceType: 'issue',
                        resourceId: issueKey
                    });
                    learnScenarioCurrentUserFromLock(data.lock);
                    mergeScenarioDraftLock(data.lock);
                } catch (err) {
                    if (err.status === 409 && err.payload?.activeLock) {
                        mergeScenarioDraftLock(err.payload.activeLock);
                    }
                }
            };

            const refreshScenarioIssueLock = async (issueKey) => {
                if (!scenarioActiveDraftReady || scenarioDraftRealtimeStatus.paused || !issueKey) return;
                try {
                    const data = await postScenarioRealtimeJson(scenarioActiveDraftId, '/locks', {
                        action: 'refresh',
                        resourceType: 'issue',
                        resourceId: issueKey
                    });
                    learnScenarioCurrentUserFromLock(data.lock);
                    mergeScenarioDraftLock(data.lock);
                } catch (err) {
                    if (err.status === 409 && err.payload?.activeLock) {
                        mergeScenarioDraftLock(err.payload.activeLock);
                    }
                }
            };

            const releaseScenarioIssueLock = async (issueKey) => {
                if (!scenarioActiveDraftReady || !issueKey) return;
                try {
                    const data = await postScenarioRealtimeJson(scenarioActiveDraftId, '/locks', {
                        action: 'release',
                        resourceType: 'issue',
                        resourceId: issueKey
                    });
                    if (data.lock?.released) {
                        removeScenarioDraftLock('issue', issueKey);
                    }
                } catch (err) {
                    // Advisory locks must not block local editing.
                }
            };

            const handleScenarioBarMouseDown = (event, issue) => {
                if (!scenarioEditMode) return;
                if (event.button !== 0) return;
                // Only drag issues with SP > 0
                const sp = Number(issue.sp);
                if (!sp || sp <= 0) return;
                if (!issue.start || !issue.end) return;

                event.preventDefault();
                event.stopPropagation();

                const barEl = event.currentTarget;
                const trackEl = barEl.closest('.scenario-lane-track');
                if (!trackEl) return;

                const trackRect = trackEl.getBoundingClientRect();
                const barRect = barEl.getBoundingClientRect();
                const startDate = parseScenarioDate(issue.start);
                const endDate = parseScenarioDate(issue.end);
                if (!startDate || !endDate) return;

                const durationMs = endDate.getTime() - startDate.getTime();
                const offsetX = event.clientX - barRect.left;

                const dragState = {
                    issueKey: issue.key,
                    originalStart: issue.start,
                    originalEnd: issue.end,
                    durationMs,
                    offsetX,
                    trackLeft: trackRect.left,
                    trackWidth: trackRect.width,
                    currentStart: startDate,
                    currentEnd: endDate,
                };
                scenarioDragStateRef.current = dragState;
                scenarioWasDraggedRef.current = false;
                setScenarioDragState(dragState);
                acquireScenarioIssueLock(issue.key);
                if (scenarioDragLockRefreshRef.current) {
                    window.clearInterval(scenarioDragLockRefreshRef.current);
                }
                scenarioDragLockRefreshRef.current = window.setInterval(() => {
                    refreshScenarioIssueLock(issue.key);
                }, 4000);
            };

            useEffect(() => {
                if (selectedView !== 'eng') return;
                if (!activeGroupId) return;
                if (selectedSprint === null) return;
                if (groupsLoading) return;
                if (lastLoadedSprintRef.current !== selectedSprint) return;
                if (!tasksFetched) return;
                if (productTasksLoading || techTasksLoading) return;
                const signature = `${activeGroupId}::${activeGroupTeamIds.join('|')}::${selectedSprint}`;
                if (readyToCloseLoadRef.current === signature) return;
                readyToCloseLoadRef.current = signature;
                loadReadyToCloseProductTasks();
                loadReadyToCloseTechTasks();
            }, [selectedView, activeGroupId, activeGroupTeamIds.join('|'), selectedSprint, groupsLoading, tasksFetched, productTasksLoading, techTasksLoading]);

            useEffect(() => {
                if (selectedView !== 'eng') return;
                let cancelled = false;
                if (!isFutureSprintSelected) {
                    setBacklogProductEpics([]);
                    setBacklogTechEpics([]);
                    return;
                }
                if (groupsLoading) return;
                if (activeGroupId && activeGroupTeamIds.length === 0) {
                    setBacklogProductEpics([]);
                    setBacklogTechEpics([]);
                    return;
                }
                const loadBacklog = async () => {
                    try {
                        const [product, tech] = await Promise.all([
                            fetchBacklogEpics('product'),
                            fetchBacklogEpics('tech')
                        ]);
                        if (cancelled) return;
                        setBacklogProductEpics(product);
                        setBacklogTechEpics(tech);
                    } catch (err) {
                        if (cancelled) return;
                        setBacklogProductEpics([]);
                        setBacklogTechEpics([]);
                    }
                };
                loadBacklog();
                return () => {
                    cancelled = true;
                };
            }, [selectedView, isFutureSprintSelected, groupsLoading, activeGroupId, activeGroupTeamIds.join('|'), selectedSprint, configRefreshNonce]);

            useEffect(() => {
                if (!showScenario) return;
                if (!selectedSprint) return;
                if (groupsLoading) return;
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
                activeGroupTeamIds.join('|')
            ]);


            const effectivePriorityWeightMap = React.useMemo(
                () => buildPriorityWeightMap(effectivePriorityWeightsRows),
                [effectivePriorityWeightsRows]
            );

            const normalizeCapacityKey = (name) => {
                if (!name) return '';
                return String(name)
                    .replace(/\u00a0/g, ' ')
                    .replace(/^\[archived\]\s*/i, '')
                    .replace(/^r&d\s+/i, '')
                    .replace(/^(product|tech)\s*-\s*/i, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
            };

            const toCapacityShortName = (name) => {
                if (!name) return '';
                return String(name)
                    .replace(/\u00a0/g, ' ')
                    .replace(/^\[archived\]\s*/i, '')
                    .replace(/^r&d\s+/i, '')
                    .replace(/^(product|tech)\s*-\s*/i, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            };

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
            const killedTasks = React.useMemo(
                () => tasks.filter(t => t.fields.status?.name === 'Killed'),
                [tasks]
            );
            const doneTasks = React.useMemo(
                () => tasks.filter(t => t.fields.status?.name === 'Done'),
                [tasks]
            );
            const incompleteTasks = React.useMemo(
                () => tasks.filter(t => normalizeStatus(t.fields.status?.name) === 'incomplete'),
                [tasks]
            );
            const techTasksCount = techTasks.length;
            const productTasksCount = productTasks.length;

            const teamOptions = React.useMemo(() => {
                const base = ['all', ...new Set(capacityTasks.map(t => getTeamInfo(t).id || 'unknown'))]
                    .map(id => ({
                        id,
                        name: id === 'all' ? 'All Teams' : getTeamInfo(capacityTasks.find(t => getTeamInfo(t).id === id) || {}).name
                    }))
                    .filter((team, index, arr) => arr.findIndex(t => t.id === team.id) === index);
                if (!activeGroupTeamIds.length) {
                    return base.length ? base : [{ id: 'all', name: 'All Teams' }];
                }
                return base.filter(team => team.id === 'all' || activeGroupTeamSet.has(team.id));
            }, [capacityTasks, activeGroupTeamIds, activeGroupTeamSet]);
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

            useEffect(() => {
                if (!teamSelectionScopeKey || !activeGroupId || selectedSprint === null) return;
                if (groupsLoading || !tasksFetched) return;

                const validTeamIds = teamOptions
                    .map(team => String(team?.id || '').trim())
                    .filter(id => id && id !== 'all');
                const storedState = loadTeamSelectionState(window.localStorage, teamSelectionScopeKey);
                const baseState = resolveTeamSelectionHydrationState({
                    storedState,
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

                teamSelectionHydratedScopeRef.current = teamSelectionScopeKey;
                teamSelectionSkipPersistScopeRef.current = teamSelectionScopeKey;
                setSelectedTeams(prev => {
                    const normalizedPrev = normalizeSelectedTeams(prev);
                    const sameLength = normalizedPrev.length === nextSelectedTeams.length;
                    const sameTeams = sameLength && normalizedPrev.every((id, index) => id === nextSelectedTeams[index]);
                    return sameTeams ? prev : nextSelectedTeams;
                });
                saveTeamSelectionState(window.localStorage, teamSelectionScopeKey, {
                    selectedTeams: nextSelectedTeams
                });
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

            const scenarioTeamIds = React.useMemo(() => {
                if (isAllTeamsSelected) {
                    return teamOptions.filter(team => team.id !== 'all').map(team => team.id);
                }
                return Array.from(selectedTeamSet);
            }, [isAllTeamsSelected, selectedTeamSet, teamOptions]);


            const toggleTeamSelection = (teamId) => {
                if (teamId === 'all') {
                    setSelectedTeams(['all']);
                    return;
                }
                setSelectedTeams((prev) => {
                    const next = new Set((prev || []).filter(id => id !== 'all'));
                    if (next.has(teamId)) {
                        next.delete(teamId);
                    } else {
                        next.add(teamId);
                    }
                    return next.size ? Array.from(next) : ['all'];
                });
            };

            const excludedEpicSet = React.useMemo(() => {
                const set = new Set();
                (activeGroupExcludedCapacityEpics || []).forEach((key) => {
                    const normalized = String(key || '').trim().toUpperCase();
                    if (normalized) set.add(normalized);
                });
                (excludedStatsEpics || []).forEach((key) => {
                    const normalized = String(key || '').trim().toUpperCase();
                    if (normalized) set.add(normalized);
                });
                return set;
            }, [excludedStatsEpics, activeGroupExcludedCapacityEpics]);
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
            }, [statsTaskList, selectedSprintInfo?.name, showStats, perfEnabled, techProjectKeys]);

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
                if (!startQuarter) return '';
                return `${startQuarter}::${cohortScopedTeamSignature}`;
            }, [cohortStartQuarter, cohortScopedTeamSignature]);

            useEffect(() => {
                if (!showStats || statsView !== 'burnout') return;
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
                    setBurnoutLoading(true);
                    setBurnoutError('');
                    try {
                        const response = await fetch(`${BACKEND_URL}/api/stats/burnout`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Requested-With': 'jira-execution-planner'
                            },
                            cache: 'no-cache',
                            signal: controller.signal,
                            body: JSON.stringify({
                                sprint: sprintLabel,
                                teamIds: burnoutScopedTeamIds,
                                issueKeys: burnoutIssueKeys,
                                includePostSprintClosures: isCompletedSprintSelected
                            })
                        });
                        if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err.error || err.message || `Burndown fetch failed (${response.status})`);
                        }
                        const payload = await response.json();
                        if (cancelled) return;
                        const data = payload?.data || null;
                        burnoutCacheRef.current[burnoutQueryKey] = data;
                        setBurnoutData(data);
                    } catch (err) {
                        if (cancelled) return;
                        if (err.name === 'AbortError') {
                            setBurnoutError('Burndown request timed out (30s). Narrow scope with team or assignee filter.');
                            setBurnoutData(null);
                            return;
                        }
                        setBurnoutError(String(err.message || err));
                        setBurnoutData(null);
                    } finally {
                        window.clearTimeout(timeoutId);
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
                isCompletedSprintSelected
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
                const startQuarter = String(cohortStartQuarter || '').trim();
                if (!startQuarter) {
                    setCohortData(null);
                    setCohortError('Start quarter is required.');
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
                    setCohortLoading(true);
                    setCohortError('');
                    try {
                        const response = await fetch(`${BACKEND_URL}/api/stats/epic-cohort`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Requested-With': 'jira-execution-planner'
                            },
                            cache: 'no-cache',
                            signal: controller.signal,
                            body: JSON.stringify({
                                startQuarter: startQuarter,
                                teamIds: burnoutScopedTeamIds,
                                components: activeGroupMissingComponents,
                                refresh: false
                            })
                        });
                        if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err.error || err.message || `Lead times fetch failed (${response.status})`);
                        }
                        const payload = await response.json();
                        if (cancelled) return;
                        const data = payload?.data || null;
                        cohortCacheRef.current[cohortQueryKey] = data;
                        setCohortData(data);
                        setCohortError('');
                    } catch (err) {
                        if (cancelled) return;
                        if (err?.name === 'AbortError') {
                            setCohortError('Lead times request timed out (30s). Narrow scope with team filters.');
                        } else {
                            setCohortError(String(err?.message || err || 'Failed to load lead times data.'));
                        }
                        setCohortData(null);
                    } finally {
                        window.clearTimeout(timeoutId);
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
            }, [showStats, statsView, cohortStartQuarter, cohortQueryKey, cohortScopedTeamSignature, burnoutScopedTeamSignature, activeGroupMissingComponents]);

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
                    excludeEpicKeys: cohortExcludeCapacity ? excludedEpicSet : EMPTY_ARRAY,
                    statusToggles: cohortStatusToggles
                });
            }, [cohortIssues, cohortProjectFilter, cohortAssigneeFilter, cohortExcludeCapacity, cohortStatusToggles, excludedEpicSet]);
            const cohortSummary = React.useMemo(() => aggregateCohortSummary(cohortFilteredIssues), [cohortFilteredIssues]);
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
                if (!showStats || (statsView !== 'excludedCapacity' && statsView !== 'monoCrossShare')) return;
                if (statsView === 'excludedCapacity' && !excludedCapacityEpicOptions.length) {
                    setExcludedCapacityData(null);
                    setExcludedCapacityError('No excluded capacity epics are configured for this team group.');
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

                let cancelled = false;
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
                        if (data) {
                            excludedCapacityCacheRef.current[sprintCacheKey] = data;
                        }
                        return data;
                    } catch (err) {
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
                    setExcludedCapacityLoading(true);
                    setExcludedCapacityError('');
                    try {
                        const result = await loadExcludedCapacityStatsSourceChunks(excludedCapacitySprintIds, fetchSprintChunk, {
                            maxConcurrent: EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY,
                            isCancelled: () => cancelled,
                            onProgress: (chunks, progressMeta) => {
                                if (cancelled) return;
                                setExcludedCapacityData(mergeExcludedCapacityStatsSourceChunks(chunks, {
                                    loadedSprintCount: progressMeta.loadedSprintCount,
                                    totalSprintCount: progressMeta.totalSprintCount
                                }));
                            }
                        });
                        if (cancelled) return;
                        if (result.errors.length === excludedCapacitySprintIds.length) {
                            throw new Error('Excluded capacity source failed for all selected sprints.');
                        }
                        const data = mergeExcludedCapacityStatsSourceChunks(result.chunks, {
                            loadedSprintCount: result.chunks.length,
                            totalSprintCount: excludedCapacitySprintIds.length
                        });
                        excludedCapacityCacheRef.current[rangeCacheKey] = data;
                        setExcludedCapacityData(data);
                    } catch (err) {
                        if (cancelled) return;
                        if (err?.name === 'AbortError') {
                            setExcludedCapacityError('Excluded capacity sprint request timed out (30s). Narrow the sprint range or team filter.');
                        } else {
                            setExcludedCapacityError(String(err?.message || err || 'Failed to load excluded capacity data.'));
                        }
                        setExcludedCapacityData(null);
                    } finally {
                        if (!cancelled) setExcludedCapacityLoading(false);
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
                activeGroupId,
                activeGroupTeamIds.length,
                excludedCapacityRefreshNonce
            ]);
            const excludedCapacityIssues = React.useMemo(() => {
                return Array.isArray(excludedCapacityData?.issues) ? excludedCapacityData.issues : [];
            }, [excludedCapacityData]);
            const excludedCapacityEpicCatalog = React.useMemo(() => {
                return buildExcludedEpicCatalog(excludedCapacityIssues, {
                    excludedEpicKeys: excludedCapacityEpicOptions
                });
            }, [excludedCapacityIssues, excludedCapacityEpicOptions]);
            const excludedCapacityAutoEpicKeys = React.useMemo(
                () => pickAutoSelectedExcludedEpics(excludedCapacityEpicCatalog),
                [excludedCapacityEpicCatalog]
            );
            useEffect(() => {
                if (excludedCapacitySelectedEpicKeys === null && excludedCapacityEpicCatalog.length) {
                    setExcludedCapacitySelectedEpicKeys(excludedCapacityAutoEpicKeys);
                }
            }, [excludedCapacitySelectedEpicKeys, excludedCapacityEpicCatalog, excludedCapacityAutoEpicKeys]);
            useEffect(() => {
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
                const autoSet = new Set(excludedCapacityAutoEpicKeys);
                const isAutoSelection = autoSet.size === excludedCapacityEffectiveFilters.length &&
                    excludedCapacityEffectiveFilters.every(key => autoSet.has(key));
                if (isAutoSelection) {
                    return `Filter: BAU / ad hoc (${excludedCapacityEffectiveFilters.length})`;
                }
                return `Filter: ${excludedCapacityEffectiveFilters.length} of ${excludedCapacityEpicOptions.length} selected`;
            }, [excludedCapacityEffectiveFilters, excludedCapacityEpicOptions, excludedCapacityAutoEpicKeys]);
            const excludedCapacityActiveFilters = excludedCapacityEffectiveFilters.length
                ? excludedCapacityEffectiveFilters
                : excludedCapacityEpicOptions;
            const effortSplitRows = React.useMemo(() => {
                return buildEffortTypeSplitRows(excludedCapacityIssues, excludedCapacitySprintRange, {
                    excludedEpicKeys: excludedCapacityEpicOptions,
                    excludedEpicKeyFilters: excludedCapacityActiveFilters,
                    teams: excludedCapacityTeams,
                    techProjectKeys: Array.from(techProjectKeys)
                });
            }, [
                excludedCapacityIssues,
                excludedCapacitySprintRange,
                excludedCapacityEpicOptions,
                excludedCapacityActiveFilters,
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
            const selectAutoExcludedCapacityEpics = () => {
                setExcludedCapacitySelectedEpicKeys(excludedCapacityAutoEpicKeys.slice());
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

            const scenarioRawIssues = scenarioData?.issues || EMPTY_ARRAY;
            const scenarioConfig = scenarioData?.config || EMPTY_OBJECT;
            const scenarioSummary = scenarioData?.summary || EMPTY_OBJECT;
            const scenarioBaseUrl = scenarioData?.jira_base_url || jiraUrl || '';
            const scenarioDependencies = scenarioData?.dependencies || EMPTY_ARRAY;
            const scenarioCapacityByTeam = scenarioData?.capacity_by_team || EMPTY_OBJECT;
            const scenarioScopeKey = React.useMemo(() => {
                const sprintId = selectedSprint ? String(selectedSprint) : '';
                const groupId = activeGroupId || 'default';
                return sprintId && groupId ? `${sprintId}:${groupId}` : '';
            }, [selectedSprint, activeGroupId]);
            const scenarioOverridesSignature = React.useMemo(
                () => scenarioDraftOverridesSignature(scenarioOverrides),
                [scenarioOverrides]
            );
            const savedScenarioOverridesSignature = React.useMemo(
                () => scenarioDraftOverridesSignature(scenarioDraftMeta.savedOverrides),
                [scenarioDraftMeta.savedOverrides]
            );
            useEffect(() => {
                const dirtyState = scenarioOverridesSignature === savedScenarioOverridesSignature ? 'clean' : 'dirty';
                setScenarioDraftMeta(prev => (
                    prev.dirtyState === dirtyState ? prev : { ...prev, dirtyState }
                ));
            }, [scenarioOverridesSignature, savedScenarioOverridesSignature]);
            const scenarioHasUnsavedChanges = scenarioOverridesSignature !== savedScenarioOverridesSignature;
            const scenarioHasStoredDraftScope = Boolean(
                scenarioDraftMeta.scopeKey
                && scenarioDraftMeta.scopePayload
                && Object.keys(scenarioDraftMeta.scopePayload).length > 0
            );
            const scenarioCanSaveDraft = scenarioHasUnsavedChanges
                && !scenarioDraftMeta.loadingHistory
                && !scenarioDraftMeta.saving
                && scenarioDraftMeta.dirtyState !== 'conflict_remote'
                && !scenarioDraftMeta.conflict
                && Boolean((scenarioData && scenarioScopeKey) || scenarioHasStoredDraftScope);
            const scenarioActiveDraftId = scenarioDraftMeta.activeDraft?.draftId || '';
            scenarioActiveDraftIdRef.current = scenarioActiveDraftId;
            scenarioScopeKeyRef.current = scenarioScopeKey;
            const isScenarioScopeDraftCurrent = React.useCallback((expectedScopeKey, expectedDraftId = '') => {
                if (scenarioScopeKeyRef.current !== expectedScopeKey) return false;
                if (expectedDraftId && scenarioActiveDraftIdRef.current !== expectedDraftId) return false;
                return true;
            }, []);
            const scenarioActiveDraftReady = Boolean(
                showScenario
                && scenarioData
                && scenarioActiveDraftId
                && scenarioDraftMeta.scopeKey === scenarioScopeKey
            );
            const scenarioCurrentUserIdentifiers = React.useMemo(() => {
                return new Set([
                    scenarioCurrentUserIdentity.userId,
                    scenarioCurrentUserIdentity.displayName
                ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
            }, [scenarioCurrentUserIdentity]);
            const isScenarioCurrentUser = React.useCallback((values) => {
                if (!scenarioCurrentUserIdentifiers.size) return false;
                return values
                    .map(value => String(value || '').trim().toLowerCase())
                    .filter(Boolean)
                    .some(value => scenarioCurrentUserIdentifiers.has(value));
            }, [scenarioCurrentUserIdentifiers]);
            const scenarioRemoteEditors = React.useMemo(() => {
                return (scenarioDraftPresence || [])
                    .filter(item => !isScenarioPresenceExpired(item))
                    .filter(item => {
                        const displayName = String(item?.displayName || '').trim();
                        return displayName && !isScenarioCurrentUser([item?.userId, item?.displayName]);
                    })
                    .map(item => ({
                        ...item,
                        displayName: String(item.displayName || '').trim()
                    }));
            }, [scenarioDraftPresence, isScenarioCurrentUser]);
            const scenarioIssueLockWarnings = React.useMemo(() => {
                return (scenarioDraftLocks || [])
                    .filter(lock => String(lock?.resourceType || '') === 'issue' && lock?.resourceId)
                    .filter(lock => !isScenarioLockExpired(lock))
                    .filter(lock => !isScenarioCurrentUser([lock?.holderUserId, lock?.holderDisplayName]))
                    .map(lock => ({
                        issueKey: String(lock.resourceId || '').trim(),
                        holderDisplayName: String(lock.holderDisplayName || 'Another editor').trim() || 'Another editor'
                    }));
            }, [scenarioDraftLocks, isScenarioCurrentUser]);

            React.useEffect(() => {
                if (scenarioHistoryRefreshControllerRef.current) {
                    scenarioHistoryRefreshControllerRef.current.abort();
                    scenarioHistoryRefreshControllerRef.current = null;
                }
                if (scenarioHistoryActionControllerRef.current) {
                    scenarioHistoryActionControllerRef.current.abort();
                    scenarioHistoryActionControllerRef.current = null;
                }
            }, [scenarioActiveDraftId, scenarioScopeKey]);

            React.useEffect(() => {
                if (!scenarioActiveDraftReady) return undefined;
                let cancelled = false;
                const controllers = new Set();
                const expectedDraftId = scenarioActiveDraftId;
                const expectedScopeKey = scenarioScopeKey;
                const poll = async () => {
                    const controller = new AbortController();
                    controllers.add(controller);
                    try {
                        const data = await pollScenarioDraftEvents(expectedDraftId, scenarioDraftLastEventNumber, controller.signal);
                        const stillCurrent = !cancelled
                            && scenarioActiveDraftIdRef.current === expectedDraftId
                            && scenarioScopeKeyRef.current === expectedScopeKey;
                        if (!stillCurrent) {
                            return;
                        }
                        data.events.forEach(applyScenarioDraftEvent);
                        if (data.nextSince > 0) {
                            setScenarioDraftLastEventNumber(prev => Math.max(prev, data.nextSince));
                        }
                        setScenarioDraftRealtimeStatus(prev => (
                            prev.paused ? prev : { mode: 'polling', paused: false, message: '' }
                        ));
                    } catch (err) {
                        if (!cancelled && err.name !== 'AbortError') {
                            setScenarioDraftRealtimeStatus(prev => (
                                prev.paused ? prev : { mode: 'polling', paused: false, message: 'Realtime polling will retry.' }
                            ));
                        }
                    } finally {
                        controllers.delete(controller);
                    }
                };
                poll();
                const intervalId = window.setInterval(poll, 5000);
                return () => {
                    cancelled = true;
                    window.clearInterval(intervalId);
                    controllers.forEach(controller => {
                        try {
                            controller.abort();
                        } catch (err) {
                            // ignore abort errors
                        }
                    });
                    controllers.clear();
                };
            }, [scenarioActiveDraftReady, scenarioActiveDraftId, scenarioScopeKey, scenarioDraftLastEventNumber]);

            React.useEffect(() => {
                if (!scenarioActiveDraftReady) return undefined;
                if (scenarioDraftRealtimeStatus.paused) return undefined;
                let cancelled = false;
                const heartbeat = async () => {
                    try {
                        await postScenarioRealtimeJson(scenarioActiveDraftId, '/presence', {
                            mode: scenarioEditMode ? 'editing' : 'viewing',
                            cursorPayload: {}
                        }).then(data => learnScenarioCurrentUserFromPresence(data.presence));
                    } catch (err) {
                        if (!cancelled && !(err.status === 403 && err.payload?.error === 'csrf_required')) {
                            pauseScenarioRealtime('Realtime paused; keep editing local-only until the connection recovers.');
                        }
                    }
                };
                heartbeat();
                const intervalId = window.setInterval(heartbeat, 25000);
                return () => {
                    cancelled = true;
                    window.clearInterval(intervalId);
                };
            }, [scenarioActiveDraftReady, scenarioActiveDraftId, scenarioDraftRealtimeStatus.paused, scenarioEditMode]);

            React.useEffect(() => {
                if (!scenarioActiveDraftReady) return undefined;
                const sseEnabled = window.SCENARIO_DRAFT_SSE_ENABLED === true;
                if (!sseEnabled || typeof window.EventSource !== 'function') return undefined;
                const source = new window.EventSource(`${BACKEND_URL}/api/scenario/drafts/${encodeURIComponent(scenarioActiveDraftId)}/events/stream?since=${encodeURIComponent(scenarioDraftLastEventNumber || 0)}`);
                const expectedDraftId = scenarioActiveDraftId;
                const handleStreamMessage = (message) => {
                    if (scenarioActiveDraftIdRef.current !== expectedDraftId) return;
                    try {
                        applyScenarioDraftEvent(JSON.parse(message.data));
                    } catch (err) {
                        // Malformed stream events are ignored; polling remains the fallback.
                    }
                };
                source.onmessage = handleStreamMessage;
                [
                    'draft.saved',
                    'draft.rolled_back',
                    'presence.updated',
                    'lock.acquired',
                    'lock.refreshed',
                    'lock.released'
                ].forEach(eventType => {
                    source.addEventListener(eventType, handleStreamMessage);
                });
                source.onerror = () => {
                    setScenarioDraftRealtimeStatus(prev => (
                        prev.paused ? prev : { mode: 'polling', paused: false, message: 'Realtime stream disconnected; polling will continue.' }
                    ));
                    try {
                        source.close();
                    } catch (err) {
                        // ignore close errors
                    }
                };
                return () => {
                    try {
                        source.close();
                    } catch (err) {
                        // ignore close errors
                    }
                };
            }, [scenarioActiveDraftReady, scenarioActiveDraftId, scenarioDraftLastEventNumber]);
            const scenarioSprintBounds = React.useMemo(() => {
                const b = scenarioData?.sprintBoundaries;
                if (!b) return [];
                return [b.previous?.startDate, b.selected?.startDate, b.selected?.endDate, b.next?.endDate]
                    .map(d => d ? parseScenarioDate(d) : null)
                    .filter(Boolean)
                    .sort((a, b) => a - b);
            }, [scenarioData]);

            // Apply virtual assignment for DevLead Management tasks
            const scenarioIssues = React.useMemo(() => {
                if (!scenarioRawIssues || scenarioRawIssues.length === 0) return scenarioRawIssues;

                return scenarioRawIssues.map(issue => {
                    // Check if this is a DevLead Management task
                    const epicSummary = issue.epicSummary || '';
                    const isDevLeadTask = epicSummary.toLowerCase().includes('devlead management') ||
                                         epicSummary.toLowerCase().includes('dev lead management');

                    // Only apply virtual assignment if task is unassigned and is a DevLead task
                    if (isDevLeadTask && !issue.assignee && issue.team) {
                        const teamCapacity = scenarioCapacityByTeam[issue.team];
                        const devLead = teamCapacity?.devLead;

                        if (devLead) {
                            // Return a new issue object with virtual assignment
                            return { ...issue, assignee: devLead };
                        }
                    }

                    return issue;
                });
            }, [scenarioRawIssues, scenarioCapacityByTeam]);
            const scenarioEffectiveIssues = React.useMemo(() => {
                if (!scenarioIssues || scenarioIssues.length === 0) return scenarioIssues;
                return scenarioIssues.map(issue => applyIssueOverride(issue, scenarioOverrides[issue.key] || null));
            }, [scenarioIssues, scenarioOverrides]);
            const scenarioSearchQuery = React.useMemo(
                () => (searchQuery || '').trim().toLowerCase(),
                [searchQuery]
            );
            const scenarioSearchMatchSet = React.useMemo(() => {
                const matches = new Set();
                if (!scenarioSearchQuery || !scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return matches;
                scenarioEffectiveIssues.forEach(issue => {
                    if (issue?.key && matchesScenarioSearch(issue, scenarioSearchQuery)) {
                        matches.add(issue.key);
                    }
                });
                return matches;
            }, [scenarioEffectiveIssues, scenarioSearchQuery]);
            const scenarioFilteredIssues = React.useMemo(() => {
                if (!scenarioSearchQuery) return scenarioEffectiveIssues;
                return scenarioEffectiveIssues.filter(issue => scenarioSearchMatchSet.has(issue.key));
            }, [scenarioEffectiveIssues, scenarioSearchQuery, scenarioSearchMatchSet]);
            const scenarioExcludedIssueKeys = React.useMemo(() => {
                const keys = new Set();
                if (!scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return keys;
                scenarioEffectiveIssues.forEach(issue => {
                    if (excludedEpicSet.has(normalizeEpicKey(issue?.epicKey || ''))) {
                        keys.add(issue.key);
                    }
                });
                return keys;
            }, [scenarioEffectiveIssues, excludedEpicSet]);
            const scenarioFocusKeys = scenarioData?.focus_set?.focused_issue_keys || EMPTY_ARRAY;
            const scenarioContextKeys = scenarioData?.focus_set?.context_issue_keys || EMPTY_ARRAY;
            const scenarioFocusSet = React.useMemo(
                () => new Set(scenarioFocusKeys),
                [scenarioFocusKeys]
            );
            const scenarioContextSet = React.useMemo(
                () => new Set(scenarioContextKeys),
                [scenarioContextKeys]
            );
            const scenarioIssueByKey = React.useMemo(() => {
                const map = new Map();
                if (!scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return map;
                scenarioEffectiveIssues.forEach(issue => {
                    if (issue?.key) {
                        map.set(issue.key, issue);
                    }
                });
                return map;
            }, [scenarioEffectiveIssues]);
            const scenarioBaseStart = parseScenarioDate(scenarioConfig.start_date);
            const scenarioDeadline = parseScenarioDate(scenarioConfig.quarter_end_date);
            const scenarioBaseEnd = React.useMemo(() => {
                if (!scenarioDeadline) return null;
                if (!scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return scenarioDeadline;
                let latest = scenarioDeadline;
                scenarioEffectiveIssues.forEach(issue => {
                    if (!issue.end) return;
                    const end = parseScenarioDate(issue.end);
                    if (end && end > latest) {
                        latest = end;
                    }
                });
                return latest;
            }, [scenarioDeadline, scenarioEffectiveIssues]);
            const scenarioViewStart = scenarioRangeOverride?.start || scenarioBaseStart;
            const scenarioViewEnd = scenarioRangeOverride?.end || scenarioBaseEnd;
            scenarioViewRangeRef.current = { start: scenarioViewStart, end: scenarioViewEnd };
            const scenarioFocusEpicKey = scenarioEpicFocus?.key || null;
            const scenarioFocusIssueKeys = React.useMemo(() => {
                const keys = new Set();
                if (!scenarioFocusEpicKey || !scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return keys;
                scenarioEffectiveIssues.forEach(issue => {
                    if (issue.epicKey === scenarioFocusEpicKey && issue.key) {
                        keys.add(issue.key);
                    }
                });
                return keys;
            }, [scenarioEffectiveIssues, scenarioFocusEpicKey]);
            const scenarioFocusContextKeys = React.useMemo(() => {
                const keys = new Set();
                if (!scenarioFocusEpicKey) return keys;
                (scenarioDependencies || []).forEach(edge => {
                    if (!edge?.from || !edge?.to) return;
                    const fromInFocus = scenarioFocusIssueKeys.has(edge.from);
                    const toInFocus = scenarioFocusIssueKeys.has(edge.to);
                    if (fromInFocus && !toInFocus) {
                        keys.add(edge.to);
                    } else if (toInFocus && !fromInFocus) {
                        keys.add(edge.from);
                    }
                });
                return keys;
            }, [scenarioDependencies, scenarioFocusIssueKeys, scenarioFocusEpicKey]);
            const scenarioTimelineIssues = React.useMemo(() => {
                const source = scenarioEpicFocus ? scenarioEffectiveIssues : scenarioFilteredIssues;
                if (!scenarioEpicFocus) return source;
                return source.filter(issue =>
                    scenarioFocusIssueKeys.has(issue.key) || scenarioFocusContextKeys.has(issue.key)
                );
            }, [scenarioEffectiveIssues, scenarioFilteredIssues, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioFocusContextKeys]);
            const scenarioTimelineWithSegments = React.useMemo(() => {
                if (!scenarioTimelineIssues || scenarioTimelineIssues.length === 0) return scenarioTimelineIssues;
                if (!scenarioSprintBounds || scenarioSprintBounds.length < 2) return scenarioTimelineIssues;
                // Clip excluded capacity issues to the selected sprint window so
                // they never extend beyond the sprint they belong to.
                const sprintStartISO = scenarioViewStart ? dateToISODate(scenarioViewStart) : null;
                const sprintEndISO   = scenarioDeadline  ? dateToISODate(scenarioDeadline)  : null;
                const result = [];
                scenarioTimelineIssues.forEach(issue => {
                    if (scenarioExcludedIssueKeys.has(issue.key)) {
                        const segments = splitAtSprintBoundaries(issue, scenarioSprintBounds);
                        segments.forEach(seg => {
                            if (sprintStartISO && sprintEndISO) {
                                const clippedStart = !seg.start || seg.start < sprintStartISO ? sprintStartISO : seg.start;
                                const clippedEnd   = !seg.end   || seg.end   > sprintEndISO   ? sprintEndISO   : seg.end;
                                if (clippedStart <= clippedEnd) {
                                    result.push({ ...seg, start: clippedStart, end: clippedEnd });
                                }
                            } else {
                                result.push(seg);
                            }
                        });
                    } else {
                        result.push(issue);
                    }
                });
                return result;
            }, [scenarioTimelineIssues, scenarioExcludedIssueKeys, scenarioSprintBounds, scenarioViewStart, scenarioDeadline]);
            const scenarioTimelineIssueKeys = React.useMemo(() => {
                return new Set(scenarioTimelineWithSegments.map(issue => issue.key));
            }, [scenarioTimelineWithSegments]);
            const scenarioAssigneeConflicts = React.useMemo(() => {
                // Early return if no data to avoid unnecessary computation
                if (!scenarioTimelineIssues || scenarioTimelineIssues.length === 0) {
                    return { conflicts: new Set(), conflictDetails: new Map() };
                }

                const conflicts = new Set();
                const conflictDetails = new Map();
                const assigneeMap = new Map();

                // Group issues by assignee
                scenarioTimelineIssues.forEach(issue => {
                    const assignee = issue.assignee;
                    if (!assignee) return;
                    if (!issue.start || !issue.end) return;

                    // Skip excluded tasks - they're just noise and shouldn't create conflicts
                    const isExcluded = excludedEpicSet.has(normalizeEpicKey(issue.epicKey || ''));
                    if (isExcluded) return;

                    // Skip done tasks - they're complete and can't create real conflicts
                    if (issue.scheduledReason === 'already_done') return;

                    const startDate = parseScenarioDate(issue.start);
                    const endDate = parseScenarioDate(issue.end);
                    if (!startDate || !endDate) return;

                    if (!assigneeMap.has(assignee)) {
                        assigneeMap.set(assignee, []);
                    }
                    assigneeMap.get(assignee).push({
                        key: issue.key,
                        start: startDate,
                        end: endDate,
                        summary: issue.summary
                    });
                });

                // Check for overlaps within each assignee's tasks
                assigneeMap.forEach((tasks, assignee) => {
                    if (tasks.length < 2) return;

                    // Sort by start date
                    tasks.sort((a, b) => a.start - b.start);

                    // Only check adjacent tasks (optimization)
                    for (let i = 0; i < tasks.length - 1; i++) {
                        const task1 = tasks[i];
                        const task2 = tasks[i + 1];

                        // Check if task1 ends AFTER task2 starts (true overlap)
                        if (task1.end && task2.start && task1.end.getTime() > task2.start.getTime()) {
                            conflicts.add(task1.key);
                            conflicts.add(task2.key);

                            if (!conflictDetails.has(task1.key)) {
                                conflictDetails.set(task1.key, []);
                            }
                            if (!conflictDetails.has(task2.key)) {
                                conflictDetails.set(task2.key, []);
                            }
                            conflictDetails.get(task1.key).push(task2.key);
                            conflictDetails.get(task2.key).push(task1.key);
                        }
                    }
                });

                return { conflicts, conflictDetails };
            }, [scenarioTimelineIssues, excludedEpicSet]);
            const scenarioDepViolations = React.useMemo(() => {
                if (!scenarioEditMode) return new Set();
                return validateDependencies(scenarioDependencies, scenarioIssueByKey);
            }, [scenarioEditMode, scenarioDependencies, scenarioIssueByKey]);
            const scenarioDepViolatedKeys = React.useMemo(() => {
                const keys = new Set();
                scenarioDepViolations.forEach(edge => {
                    const [from, to] = edge.split('->');
                    if (from) keys.add(from);
                    if (to) keys.add(to);
                });
                return keys;
            }, [scenarioDepViolations]);

            // --- Drag effect, undo/redo, save/discard (placed after scenarioViewStart/End & scenarioIssueByKey) ---

            // Drag mousemove/mouseup effect
            const scenarioDraggingIssueKey = scenarioDragState?.issueKey || '';
            React.useEffect(() => {
                if (!scenarioDraggingIssueKey) return;
                const handleMouseMove = (e) => {
                    const ds = scenarioDragStateRef.current;
                    if (!ds) return;
                    scenarioWasDraggedRef.current = true;
                    if (scenarioDragFrameRef.current) return; // throttle via rAF
                    scenarioDragFrameRef.current = requestAnimationFrame(() => {
                        scenarioDragFrameRef.current = null;
                        const ds2 = scenarioDragStateRef.current;
                        const viewStart = scenarioViewRangeRef.current.start;
                        const viewEnd = scenarioViewRangeRef.current.end;
                        if (!ds2 || !viewStart || !viewEnd) return;
                        const rawPx = e.clientX - ds2.trackLeft - ds2.offsetX;
                        const newStart = pxToDate(rawPx, ds2.trackWidth, viewStart, viewEnd);
                        const newEnd = new Date(newStart.getTime() + ds2.durationMs);
                        const updated = { ...ds2, currentStart: newStart, currentEnd: newEnd };
                        scenarioDragStateRef.current = updated;
                        setScenarioDragState(updated);
                    });
                };
                const handleMouseUp = () => {
                    if (scenarioDragFrameRef.current) {
                        cancelAnimationFrame(scenarioDragFrameRef.current);
                        scenarioDragFrameRef.current = null;
                    }
                    if (scenarioDragLockRefreshRef.current) {
                        window.clearInterval(scenarioDragLockRefreshRef.current);
                        scenarioDragLockRefreshRef.current = null;
                    }
                    const ds = scenarioDragStateRef.current;
                    if (ds && scenarioWasDraggedRef.current) {
                        const newStartISO = dateToISODate(ds.currentStart);
                        const newEndISO = dateToISODate(ds.currentEnd);
                        scenarioUndoStackRef.current.push({
                            issueKey: ds.issueKey,
                            oldStart: ds.originalStart,
                            oldEnd: ds.originalEnd,
                            newStart: newStartISO,
                            newEnd: newEndISO,
                        });
                        setScenarioUndoVersion(v => v + 1);
                        setScenarioOverrides(prev => ({
                            ...prev,
                            [ds.issueKey]: { start: newStartISO, end: newEndISO }
                        }));
                    }
                    if (ds?.issueKey) {
                        releaseScenarioIssueLock(ds.issueKey);
                    }
                    scenarioDragStateRef.current = null;
                    setScenarioDragState(null);
                };
                window.addEventListener('mousemove', handleMouseMove);
                window.addEventListener('mouseup', handleMouseUp);
                return () => {
                    const ds = scenarioDragStateRef.current;
                    if (scenarioDragLockRefreshRef.current) {
                        window.clearInterval(scenarioDragLockRefreshRef.current);
                        scenarioDragLockRefreshRef.current = null;
                    }
                    if (ds?.issueKey) {
                        releaseScenarioIssueLock(ds.issueKey);
                    }
                    window.removeEventListener('mousemove', handleMouseMove);
                    window.removeEventListener('mouseup', handleMouseUp);
                };
            }, [scenarioDraggingIssueKey]);

            const scenarioUndo = () => {
                const cmd = scenarioUndoStackRef.current.undo();
                if (!cmd) return;
                setScenarioUndoVersion(v => v + 1);
                setScenarioOverrides(prev => {
                    const next = { ...prev };
                    if (cmd.oldStart === cmd.newStart && cmd.oldEnd === cmd.newEnd) return next;
                    const issue = scenarioIssueByKey.get(cmd.issueKey);
                    const computedStart = issue?.start;
                    const computedEnd = issue?.end;
                    if (cmd.oldStart === computedStart && cmd.oldEnd === computedEnd) {
                        delete next[cmd.issueKey];
                    } else {
                        next[cmd.issueKey] = { start: cmd.oldStart, end: cmd.oldEnd };
                    }
                    return next;
                });
            };

            const scenarioRedo = () => {
                const cmd = scenarioUndoStackRef.current.redo();
                if (!cmd) return;
                setScenarioUndoVersion(v => v + 1);
                setScenarioOverrides(prev => ({
                    ...prev,
                    [cmd.issueKey]: { start: cmd.newStart, end: cmd.newEnd }
                }));
            };

            // Keyboard shortcuts for undo/redo
            React.useEffect(() => {
                if (!scenarioEditMode) return;
                const handler = (e) => {
                    const isMeta = e.metaKey || e.ctrlKey;
                    if (!isMeta || e.key.toLowerCase() !== 'z') return;
                    e.preventDefault();
                    if (e.shiftKey) {
                        scenarioRedo();
                    } else {
                        scenarioUndo();
                    }
                };
                window.addEventListener('keydown', handler);
                return () => window.removeEventListener('keydown', handler);
            }, [scenarioEditMode, scenarioIssueByKey]);

            const scenarioOverrideCount = Object.keys(scenarioOverrides).length;

            const saveScenarioDraft = async () => {
                const saveScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
                if (!saveScopeKey || !scenarioCanSaveDraft) return;
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    saving: true,
                    conflict: null,
                    message: '',
                    error: ''
                }));
                try {
                    const saved = await saveScenarioDraftVersion(
                        saveScopeKey,
                        `Draft ${new Date().toISOString().slice(0, 10)}`,
                        scenarioDraftMeta.baseDraftRevision,
                        saveScopeKey === scenarioScopeKey ? buildScenarioDraftScope() : (scenarioDraftMeta.scopePayload || {}),
                        scenarioOverrides,
                    );
                    const activeDraft = saved.activeDraft || null;
                    const versions = Array.isArray(saved.versions) ? saved.versions : [];
                    const savedOverrides = normalizeScenarioDraftOverrides(activeDraft?.overrides || scenarioOverrides);
                    scenarioUndoStackRef.current.clear();
                    setScenarioUndoVersion(0);
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        activeDraft,
                        versions,
                        loadedVersionNumber: activeDraft?.versionNumber || null,
                        baseDraftRevision: activeDraft?.draftRevision || null,
                        savedOverrides,
                        scopeKey: saveScopeKey,
                        dirtyState: 'clean',
                        pendingScopeChange: null,
                        saving: false,
                        staleDraft: null,
                        conflict: null,
                        message: 'Scenario draft saved.',
                        error: ''
                    }));
                } catch (err) {
                    const conflict = err.payload?.error === 'scenario_draft_conflict' && err.payload?.conflict
                        ? {
                            ...err.payload.conflict,
                            activeDraft: err.payload.activeDraft || null,
                            versions: Array.isArray(err.payload.versions) ? err.payload.versions : []
                        }
                        : null;
                    setScenarioDraftMeta(prev => {
                        if (conflict) {
                            return {
                                ...prev,
                                versions: conflict.versions.length > 0 ? conflict.versions : prev.versions,
                                saving: false,
                                dirtyState: 'conflict_remote',
                                conflict,
                                error: ''
                            };
                        }
                        return {
                            ...prev,
                            saving: false,
                            error: err.message || 'Failed to save scenario draft.'
                        };
                    });
                }
            };

            const discardScenarioOverrides = () => {
                if (!scenarioHasUnsavedChanges) return;
                setScenarioOverrides(normalizeScenarioDraftOverrides(scenarioDraftMeta.savedOverrides));
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    dirtyState: 'clean',
                        pendingScopeChange: null,
                        staleDraft: null,
                        conflict: null,
                        message: '',
                        error: ''
                }));
                scenarioUndoStackRef.current.clear();
                setScenarioUndoVersion(0);
            };

            const openScenarioDraftHistory = async () => {
                const historyScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
                const historyDraftId = scenarioDraftMeta.activeDraft?.draftId || '';
                if (scenarioHistoryRefreshControllerRef.current) {
                    scenarioHistoryRefreshControllerRef.current.abort();
                }
                const controller = new AbortController();
                scenarioHistoryRefreshControllerRef.current = controller;
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    historyOpen: true,
                    pendingHistoryAction: null,
                    loadingHistory: Boolean(historyScopeKey),
                    error: ''
                }));
                if (!historyScopeKey) return;
                try {
                    const draftData = await fetchScenarioDraft(historyScopeKey, controller.signal);
                    if (
                        scenarioHistoryRefreshControllerRef.current !== controller
                        || !isScenarioScopeDraftCurrent(historyScopeKey, historyDraftId)
                    ) {
                        return;
                    }
                    const activeDraft = draftData.activeDraft || null;
                    const versions = Array.isArray(draftData.versions) ? draftData.versions : [];
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        activeDraft: activeDraft || prev.activeDraft,
                        versions,
                        loadingHistory: false,
                        staleDraft: prev.staleDraft
                            ? {
                                ...prev.staleDraft,
                                activeDraft: activeDraft || prev.staleDraft.activeDraft || null,
                                draftRevision: activeDraft?.draftRevision || prev.staleDraft.draftRevision
                            }
                            : prev.staleDraft,
                        error: ''
                    }));
                } catch (err) {
                    if (
                        err.name === 'AbortError'
                        || scenarioHistoryRefreshControllerRef.current !== controller
                        || !isScenarioScopeDraftCurrent(historyScopeKey, historyDraftId)
                    ) {
                        return;
                    }
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        loadingHistory: false,
                        error: err.message || 'Failed to refresh scenario draft history.'
                    }));
                } finally {
                    if (scenarioHistoryRefreshControllerRef.current === controller) {
                        scenarioHistoryRefreshControllerRef.current = null;
                    }
                }
            };

            const closeScenarioDraftHistory = () => {
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    historyOpen: false,
                    pendingHistoryAction: null
                }));
                if (scenarioHistoryButtonRef.current && typeof scenarioHistoryButtonRef.current.focus === 'function') {
                    scenarioHistoryButtonRef.current.focus();
                }
            };

            const requestReloadActiveDraft = () => {
                if (scenarioHasUnsavedChanges) {
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        pendingActiveDraftReload: true,
                        error: ''
                    }));
                    return;
                }
                runReloadActiveDraft();
            };

            const cancelReloadActiveDraft = () => {
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    pendingActiveDraftReload: false
                }));
            };

            const runReloadActiveDraft = async () => {
                const scopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
                const expectedDraftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.staleDraft?.activeDraft?.draftId || '';
                if (!scopeKey) return;
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    loadingActiveDraft: true,
                    pendingActiveDraftReload: false,
                    message: '',
                    error: ''
                }));
                try {
                    const draftData = await fetchScenarioDraft(scopeKey);
                    if (!isScenarioScopeDraftCurrent(scopeKey, expectedDraftId)) {
                        return;
                    }
                    const activeDraft = draftData.activeDraft || null;
                    const versions = Array.isArray(draftData.versions) ? draftData.versions : [];
                    if (!activeDraft) {
                        setScenarioDraftMeta(prev => ({
                            ...prev,
                            versions,
                            loadingActiveDraft: false,
                            staleDraft: null,
                            message: 'No active scenario draft was found for this scope.',
                            error: ''
                        }));
                        return;
                    }
                    const overrides = normalizeScenarioDraftOverrides(activeDraft.overrides || {});
                    setScenarioOverrides(overrides);
                    scenarioUndoStackRef.current.clear();
                    setScenarioUndoVersion(0);
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        activeDraft,
                        versions,
                        loadedVersionNumber: activeDraft.versionNumber || null,
                        baseDraftRevision: activeDraft.draftRevision || null,
                        savedOverrides: overrides,
                        scopePayload: activeDraft.scopePayload || prev.scopePayload || {},
                        scopeKey,
                        dirtyState: 'clean',
                        pendingScopeChange: null,
                        loadingHistory: false,
                        loadingActiveDraft: false,
                        staleDraft: null,
                        conflict: null,
                        writebackPreview: null,
                        writebackBlocked: null,
                        message: `Reloaded active draft revision ${activeDraft.draftRevision || 'unknown'}.`,
                        error: ''
                    }));
                } catch (err) {
                    if (err.name === 'AbortError' || !isScenarioScopeDraftCurrent(scopeKey, expectedDraftId)) {
                        return;
                    }
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        loadingActiveDraft: false,
                        error: err.message || 'Failed to reload active scenario draft.'
                    }));
                }
            };

            React.useEffect(() => {
                if (!scenarioDraftMeta.historyOpen) return undefined;
                const frame = requestAnimationFrame(() => {
                    scenarioHistoryTitleRef.current?.focus();
                });
                return () => cancelAnimationFrame(frame);
            }, [scenarioDraftMeta.historyOpen]);

            React.useEffect(() => {
                if (!scenarioDraftMeta.historyOpen) return undefined;
                const handleKeyDown = (event) => {
                    if (event.key !== 'Escape') return;
                    const panel = scenarioHistoryPanelRef.current;
                    if (!panel || !panel.contains(document.activeElement)) return;
                    event.preventDefault();
                    closeScenarioDraftHistory();
                };
                window.addEventListener('keydown', handleKeyDown);
                return () => window.removeEventListener('keydown', handleKeyDown);
            }, [scenarioDraftMeta.historyOpen]);

            const requestScenarioHistoryAction = (type, versionNumber) => {
                const action = { type, versionNumber };
                if (scenarioHasUnsavedChanges) {
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        pendingHistoryAction: action,
                        error: ''
                    }));
                    return;
                }
                runScenarioHistoryAction(action);
            };

            const cancelScenarioHistoryAction = () => {
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    pendingHistoryAction: null
                }));
            };

            const requestScenarioReloadFromJira = () => {
                if (scenarioHasUnsavedChanges) {
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        pendingReloadFromJira: true,
                        error: ''
                    }));
                    return;
                }
                runScenarioReloadFromJira();
            };

            const cancelScenarioReloadFromJira = () => {
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    pendingReloadFromJira: false
                }));
            };

            const runScenarioReloadFromJira = async () => {
                const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
                if (!draftId || !scenarioDraftMeta.baseDraftRevision) return;
                const expectedScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
                if (scenarioHistoryActionControllerRef.current) {
                    scenarioHistoryActionControllerRef.current.abort();
                }
                const controller = new AbortController();
                scenarioHistoryActionControllerRef.current = controller;
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    pendingReloadFromJira: false,
                    reloadingFromJira: true,
                    error: '',
                    message: ''
                }));
                try {
                    const reloaded = await reloadScenarioDraftFromJira(
                        draftId,
                        scenarioDraftMeta.baseDraftRevision,
                        controller.signal
                    );
                    if (
                        scenarioHistoryActionControllerRef.current !== controller
                        || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
                    ) {
                        return;
                    }
                    const activeDraft = reloaded.activeDraft || null;
                    const versions = Array.isArray(reloaded.versions) ? reloaded.versions : [];
                    const savedOverrides = normalizeScenarioDraftOverrides(activeDraft?.overrides || {});
                    setScenarioOverrides(savedOverrides);
                    scenarioUndoStackRef.current.clear();
                    setScenarioUndoVersion(0);
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        activeDraft,
                        versions,
                        loadedVersionNumber: activeDraft?.versionNumber || null,
                        baseDraftRevision: activeDraft?.draftRevision || null,
                        savedOverrides,
                        dirtyState: 'clean',
                        reloadingFromJira: false,
                        staleDraft: null,
                        conflict: null,
                        writebackPreview: null,
                        writebackBlocked: null,
                        message: `Reloaded from Jira into version ${activeDraft?.versionNumber || 'unknown'}.`,
                        error: ''
                    }));
                } catch (err) {
                    if (
                        err.name === 'AbortError'
                        || scenarioHistoryActionControllerRef.current !== controller
                        || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
                    ) {
                        return;
                    }
                    const conflict = err.payload?.error === 'scenario_draft_conflict' && err.payload?.conflict
                        ? {
                            ...err.payload.conflict,
                            activeDraft: err.payload.activeDraft || null,
                            versions: Array.isArray(err.payload.versions) ? err.payload.versions : []
                        }
                        : null;
                    setScenarioDraftMeta(prev => {
                        if (conflict) {
                            return {
                                ...prev,
                                versions: conflict.versions.length > 0 ? conflict.versions : prev.versions,
                                dirtyState: 'conflict_remote',
                                reloadingFromJira: false,
                                conflict,
                                message: '',
                                error: ''
                            };
                        }
                        return {
                            ...prev,
                            reloadingFromJira: false,
                            error: err.message || 'Failed to reload scenario draft from Jira.'
                        };
                    });
                } finally {
                    if (scenarioHistoryActionControllerRef.current === controller) {
                        scenarioHistoryActionControllerRef.current = null;
                    }
                }
            };

            const previewScenarioDraftWriteback = async () => {
                const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
                if (!draftId) return;
                const expectedScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    writebackPreviewing: true,
                    writebackPreview: null,
                    writebackBlocked: null,
                    error: '',
                    message: ''
                }));
                try {
                    const preview = await postScenarioRealtimeJson(draftId, '/writeback/preview', {});
                    if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                        return;
                    }
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        writebackPreviewing: false,
                        writebackPreview: preview,
                        writebackBlocked: null,
                        error: '',
                        message: ''
                    }));
                } catch (err) {
                    if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                        return;
                    }
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        writebackPreviewing: false,
                        error: err.message || 'Failed to preview Jira write-back.'
                    }));
                }
            };

            const checkScenarioDraftWritebackGate = async () => {
                const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
                if (!draftId) return;
                const expectedScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    writebackChecking: true,
                    writebackBlocked: null,
                    error: '',
                    message: ''
                }));
                try {
                    await postScenarioRealtimeJson(draftId, '/writeback', {});
                    if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                        return;
                    }
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        writebackChecking: false,
                        writebackBlocked: null,
                        message: 'Jira write-back gate unexpectedly allowed the request.',
                        error: ''
                    }));
                } catch (err) {
                    if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                        return;
                    }
                    const blocked = err.payload?.error === 'jira_writeback_gate_blocked'
                        ? err.payload
                        : null;
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        writebackChecking: false,
                        writebackBlocked: blocked,
                        error: blocked ? '' : (err.message || 'Failed to check Jira write-back gate.')
                    }));
                }
            };

            const runScenarioHistoryAction = async (action) => {
                const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
                if (!draftId || !action?.versionNumber) return;
                const expectedScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
                if (scenarioHistoryActionControllerRef.current) {
                    scenarioHistoryActionControllerRef.current.abort();
                }
                const controller = new AbortController();
                scenarioHistoryActionControllerRef.current = controller;
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    pendingHistoryAction: null,
                    loadingVersionNumber: action.type === 'reload' ? action.versionNumber : null,
                    rollingBackVersionNumber: action.type === 'rollback' ? action.versionNumber : null,
                    error: '',
                    message: ''
                }));
                try {
                    const snapshot = await fetchScenarioDraftVersion(draftId, action.versionNumber, controller.signal);
                    if (
                        scenarioHistoryActionControllerRef.current !== controller
                        || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
                    ) {
                        return;
                    }
                    const overrides = normalizeScenarioDraftOverrides(snapshot.overrides || {});
                    if (action.type === 'reload') {
                        setScenarioOverrides(overrides);
                        scenarioUndoStackRef.current.clear();
                        setScenarioUndoVersion(0);
                        setScenarioDraftMeta(prev => ({
                            ...prev,
                            loadedVersionNumber: snapshot.versionNumber || action.versionNumber,
                            dirtyState: 'dirty_local',
                            loadingVersionNumber: null,
                            rollingBackVersionNumber: null,
                            pendingHistoryAction: null,
                            conflict: null,
                            message: `Reloaded version ${snapshot.versionNumber || action.versionNumber} locally. Save Draft to make it current.`,
                            error: ''
                        }));
                        return;
                    }

                    const rolledBack = await rollbackScenarioDraft(
                        draftId,
                        snapshot.versionNumber || action.versionNumber,
                        scenarioDraftMeta.baseDraftRevision,
                        controller.signal
                    );
                    if (
                        scenarioHistoryActionControllerRef.current !== controller
                        || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
                    ) {
                        return;
                    }
                    const activeDraft = rolledBack.activeDraft || null;
                    const versions = Array.isArray(rolledBack.versions) ? rolledBack.versions : [];
                    const savedOverrides = normalizeScenarioDraftOverrides(activeDraft?.overrides || overrides);
                    setScenarioOverrides(savedOverrides);
                    scenarioUndoStackRef.current.clear();
                    setScenarioUndoVersion(0);
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        activeDraft,
                        versions,
                        loadedVersionNumber: activeDraft?.versionNumber || snapshot.versionNumber || action.versionNumber,
                        baseDraftRevision: activeDraft?.draftRevision || null,
                        savedOverrides,
                        dirtyState: 'clean',
                        loadingVersionNumber: null,
                            rollingBackVersionNumber: null,
                            pendingHistoryAction: null,
                            staleDraft: null,
                            conflict: null,
                            message: `Rolled back to version ${snapshot.versionNumber || action.versionNumber}.`,
                            error: ''
                    }));
                } catch (err) {
                    if (
                        err.name === 'AbortError'
                        || scenarioHistoryActionControllerRef.current !== controller
                        || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
                    ) {
                        return;
                    }
                    const conflict = err.payload?.error === 'scenario_draft_conflict' && err.payload?.conflict
                        ? {
                            ...err.payload.conflict,
                            activeDraft: err.payload.activeDraft || null,
                            versions: Array.isArray(err.payload.versions) ? err.payload.versions : []
                        }
                        : null;
                    setScenarioDraftMeta(prev => {
                        if (conflict) {
                            return {
                                ...prev,
                                versions: conflict.versions.length > 0 ? conflict.versions : prev.versions,
                                dirtyState: 'conflict_remote',
                                loadingVersionNumber: null,
                                rollingBackVersionNumber: null,
                                pendingHistoryAction: null,
                                conflict,
                                message: '',
                                error: ''
                            };
                        }
                        return {
                            ...prev,
                            loadingVersionNumber: null,
                            rollingBackVersionNumber: null,
                            pendingHistoryAction: null,
                            error: err.message || 'Failed to load scenario draft history.'
                        };
                    });
                } finally {
                    if (scenarioHistoryActionControllerRef.current === controller) {
                        scenarioHistoryActionControllerRef.current = null;
                    }
                }
            };

            const scenarioLaneForIssue = (issue) => {
                if (scenarioEpicFocus?.key) {
                    return scenarioEpicFocus.key;
                }
                if (scenarioLaneMode === 'epic') {
                    return issue.epicKey || 'No Epic';
                }
                if (scenarioLaneMode === 'assignee') {
                    return issue.assignee || 'Unassigned';
                }
                return issue.team || 'Unassigned';
            };
            const scenarioLaneInfo = React.useMemo(() => {
                const info = new Map();
                if (!scenarioTimelineIssues || scenarioTimelineIssues.length === 0) {
                    if (scenarioEpicFocus?.key) {
                        info.set(scenarioEpicFocus.key, {
                            label: scenarioEpicFocus.summary || scenarioEpicFocus.key,
                            key: scenarioEpicFocus.key,
                            totalSp: 0,
                            lateCount: 0,
                            unschedulableCount: 0,
                            conflictCount: 0,
                            capacity: null
                        });
                    }
                    return info;
                }
                scenarioTimelineIssues.forEach(issue => {
                    const lane = scenarioLaneForIssue(issue);
                    const current = info.get(lane) || {
                        label: lane,
                        key: lane,
                        totalSp: 0,
                        lateCount: 0,
                        unschedulableCount: 0,
                        conflictCount: 0,
                        capacity: null
                    };
                    const countIssue = !scenarioEpicFocus || scenarioFocusIssueKeys.has(issue.key);
                    const isExcluded = scenarioExcludedIssueKeys.has(issue.key);
                    if (countIssue) {
                        current.totalSp += Number(issue.sp || 0);
                        if (!isExcluded && (!issue.start || !issue.end)) {
                            current.unschedulableCount += 1;
                        }
                        if (!isExcluded && issue.isLate) {
                            current.lateCount += 1;
                        }
                        if (!isExcluded && scenarioAssigneeConflicts.conflicts.has(issue.key)) {
                            current.conflictCount += 1;
                        }
                    }
                    if (scenarioLaneMode === 'epic') {
                        current.key = issue.epicKey || 'No Epic';
                        current.label = issue.epicSummary || issue.epicKey || 'No Epic';
                    }
                    if (scenarioLaneMode === 'team') {
                        const capacity = scenarioCapacityByTeam[issue.team || '']?.size;
                        current.capacity = capacity ?? current.capacity;
                    }
                    info.set(lane, current);
                });
                if (scenarioEpicFocus?.key) {
                    const existing = info.get(scenarioEpicFocus.key) || {
                        label: scenarioEpicFocus.key,
                        key: scenarioEpicFocus.key,
                        totalSp: 0,
                        lateCount: 0,
                        unschedulableCount: 0,
                        conflictCount: 0,
                        capacity: null
                    };
                    existing.label = scenarioEpicFocus.summary || scenarioEpicFocus.key;
                    existing.key = scenarioEpicFocus.key;
                    info.set(scenarioEpicFocus.key, existing);
                }
                return info;
            }, [scenarioTimelineIssues, scenarioLaneMode, scenarioCapacityByTeam, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioExcludedIssueKeys, scenarioAssigneeConflicts]);
            const scenarioSearchFilterEnabled = Boolean(scenarioSearchQuery && !scenarioEpicFocus);
            const scenarioLateItems = React.useMemo(() => {
                return (scenarioSummary.late_items || []).filter(key => (
                    !scenarioExcludedIssueKeys.has(key)
                    && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
                ));
            }, [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]);
            const scenarioDeadlineAtRisk = scenarioLateItems.length > 0;
            const scenarioCriticalPathItems = React.useMemo(() => {
                return (scenarioSummary.critical_path || []).filter(key => (
                    !scenarioExcludedIssueKeys.has(key)
                    && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
                ));
            }, [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]);
            const scenarioUnschedulableItems = React.useMemo(() => {
                return (scenarioSummary.unschedulable || []).filter(key => (
                    !scenarioExcludedIssueKeys.has(key)
                    && (!scenarioSearchFilterEnabled || scenarioSearchMatchSet.has(key))
                ));
            }, [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]);
            const scenarioBottleneckLanes = React.useMemo(() => {
                const lanes = scenarioSummary.bottleneck_lanes || [];
                return lanes.filter(lane => {
                    const laneInfo = scenarioLaneInfo.get(lane);
                    if (!laneInfo) return true;
                    return (laneInfo.lateCount || laneInfo.unschedulableCount);
                });
            }, [scenarioSummary, scenarioLaneInfo]);
            const scenarioLanes = React.useMemo(() => {
                const lanes = Array.from(scenarioLaneInfo.keys());
                return lanes.sort((a, b) => a.localeCompare(b));
            }, [scenarioLaneInfo]);
            const scenarioIssuesByLane = React.useMemo(() => {
                return buildLaneIssues(scenarioTimelineWithSegments, scenarioLaneMode, scenarioLaneForIssue);
            }, [scenarioTimelineWithSegments, scenarioLaneMode, scenarioEpicFocus]);
            const scenarioHasAssignees = React.useMemo(() => {
                if (!scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return false;
                return scenarioEffectiveIssues.some(issue => issue.assignee);
            }, [scenarioEffectiveIssues]);
            const scenarioUnschedulable = React.useMemo(() => {
                if (!scenarioEffectiveIssues || scenarioEffectiveIssues.length === 0) return [];
                return scenarioEffectiveIssues.filter(issue => !issue.start || !issue.end);
            }, [scenarioEffectiveIssues]);
            const scenarioTicks = React.useMemo(() => {
                if (!scenarioViewStart || !scenarioViewEnd) return [];
                const ticks = [];
                const start = new Date(scenarioViewStart.getTime());
                const end = new Date(scenarioViewEnd.getTime());

                // Generate ticks for each quarter boundary
                const startQuarter = Math.floor(start.getMonth() / 3);
                let quarterStart = new Date(start.getFullYear(), startQuarter * 3, 1);

                // If view starts mid-quarter, begin at next quarter
                if (quarterStart < start) {
                    const nextQuarter = startQuarter + 1;
                    const year = start.getFullYear() + Math.floor(nextQuarter / 4);
                    const month = (nextQuarter % 4) * 3;
                    quarterStart = new Date(year, month, 1);
                }

                let cursor = quarterStart;
                const totalMs = Math.max(1, end - start);

                while (cursor <= end) {
                    const ratio = (cursor - start) / totalMs;
                    if (ratio >= 0 && ratio <= 1) {
                        const quarter = Math.floor(cursor.getMonth() / 3) + 1;
                        const yearShort = String(cursor.getFullYear()).slice(-2);
                        ticks.push({
                            label: `Q${quarter}'${yearShort}`,
                            ratio
                        });
                    }
                    const nextMonth = cursor.getMonth() + 3;
                    cursor = new Date(cursor.getFullYear() + Math.floor(nextMonth / 12), nextMonth % 12, 1);
                }

                return ticks;
            }, [scenarioViewStart, scenarioViewEnd]);
            const scenarioQuarterMarkers = React.useMemo(() => {
                if (!scenarioViewStart || !scenarioViewEnd) return [];
                const markers = [];
                const start = new Date(scenarioViewStart.getTime());
                const end = new Date(scenarioViewEnd.getTime());
                const startQuarter = Math.floor(start.getMonth() / 3);
                let quarterStart = new Date(start.getFullYear(), startQuarter * 3, 1);
                if (quarterStart < start) {
                    const nextQuarter = startQuarter + 1;
                    const year = start.getFullYear() + Math.floor(nextQuarter / 4);
                    const month = (nextQuarter % 4) * 3;
                    quarterStart = new Date(year, month, 1);
                }
                let cursor = quarterStart;
                const deadlineDate = scenarioDeadline ? new Date(scenarioDeadline.getTime()) : null;
                while (cursor <= end) {
                    const ratio = (cursor - scenarioViewStart) / Math.max(1, scenarioViewEnd - scenarioViewStart);
                    // Skip marker if it's the same as the deadline (avoid duplicate lines)
                    const isDuplicateDeadline = deadlineDate &&
                        cursor.getFullYear() === deadlineDate.getFullYear() &&
                        cursor.getMonth() === deadlineDate.getMonth() &&
                        cursor.getDate() === deadlineDate.getDate();

                    if (ratio >= 0 && ratio <= 1 && !isDuplicateDeadline) {
                        markers.push({
                            date: new Date(cursor.getTime()),
                            ratio
                        });
                    }
                    const nextMonth = cursor.getMonth() + 3;
                    cursor = new Date(cursor.getFullYear() + Math.floor(nextMonth / 12), nextMonth % 12, 1);
                }
                return markers;
            }, [scenarioViewStart, scenarioViewEnd, scenarioDeadline]);
            const SCENARIO_LANE_HEIGHT = 52;
            const scenarioBarGap = scenarioEpicFocus ? 16 : SCENARIO_BAR_GAP;
            const scenarioLaneStacking = React.useMemo(() => {
                // Early return if no lanes to process
                if (!scenarioLanes || scenarioLanes.length === 0) {
                    return {
                        rowIndexByKey: new Map(),
                        laneRowCounts: new Map(),
                        laneVisibleRows: new Map(),
                        laneHiddenCounts: new Map(),
                        laneRowAssignees: new Map()
                    };
                }

                if (perfEnabled) {
                    perfCountersRef.current.laneStacking += 1;
                    performance.mark('scenarioLaneStacking:start');
                }
                const rowIndexByKey = new Map();
                const laneRowCounts = new Map();
                const laneVisibleRows = new Map();
                const laneHiddenCounts = new Map();
                const laneRowAssignees = new Map();
                const fallbackStart = scenarioViewStart || new Date(0);
                const DAY_MS = 24 * 60 * 60 * 1000;
                const assignRows = (issueList, rowEnds, baseOffset, rowAssignees, options = {}) => {
                    const allowNewRows = options.allowNewRows !== false;
                    const allowAssigneeMix = options.allowAssigneeMix === true;
                    issueList.forEach((issue) => {
                        if (!issue?.key) return;
                        const assignee = issue.assignee || null;
                        const isUnscheduled = !issue.start || !issue.end;
                        const start = parseScenarioDate(issue.start) || fallbackStart;
                        const end = parseScenarioDate(issue.end) || start;
                        // Ensure every task occupies at least 1 day so bars never visually overlap
                        const rawEnd = end < start ? start : end;
                        const normalizedEnd = rawEnd <= start
                            ? new Date(start.getTime() + DAY_MS)
                            : rawEnd;

                        // Find a row where:
                        // 1. Time is available (start >= rowEnd)
                        // 2. Row either has no assignee yet, OR has the same assignee
                        let rowIndex = rowEnds.findIndex((rowEnd, idx) => {
                            const timeAvailable = start > rowEnd;
                            const rowAssignee = rowAssignees[idx];
                            const assigneeMatch = allowAssigneeMix || !rowAssignee || rowAssignee === assignee;
                            return timeAvailable && assigneeMatch;
                        });

                        if (rowIndex === -1) {
                            if (!allowNewRows) return;
                            // No suitable row found, create new one
                            rowIndex = rowEnds.length;
                            rowEnds.push(normalizedEnd);
                            rowAssignees[rowIndex] = assignee;
                        } else {
                            // Update existing row
                            rowEnds[rowIndex] = normalizedEnd;
                            // Keep the assignee if row already had one, or set it if it was empty
                            if (!rowAssignees[rowIndex]) {
                                rowAssignees[rowIndex] = assignee;
                            }
                        }
                        rowIndexByKey.set(issue.key, baseOffset + rowIndex);
                    });
                };
                scenarioLanes.forEach((lane) => {
                    const issues = scenarioIssuesByLane.get(lane) || [];
                    const rowEnds = [];
                    const rowAssignees = []; // Track which assignee is on each row
                    const capacitySize = scenarioLaneMode === 'team'
                        ? Number(scenarioCapacityByTeam[lane || '']?.size)
                        : null;
                    const capacityRows = Number.isFinite(capacitySize) && capacitySize > 0
                        ? Math.max(1, Math.round(capacitySize) + SCENARIO_TEAM_LEAD_ROWS)
                        : null;
                    const regularIssues = [];
                    const rawCapacityIssues = [];
                    issues.forEach((issue) => {
                        if (!issue?.key) return;
                        const issueKeyForExclude = issue.originalKey || issue.key;
                        if (scenarioExcludedIssueKeys.has(issueKeyForExclude) || excludedEpicSet.has(normalizeEpicKey(issue.epicKey || ''))) {
                            rawCapacityIssues.push(issue);
                        } else {
                            regularIssues.push(issue);
                        }
                    });
                    // Regular tasks fill top rows; excluded capacity always goes
                    // below all regular rows (never shares a row with regular tasks).
                    // Excluded dates are already clipped to the sprint in
                    // scenarioTimelineWithSegments.
                    assignRows(regularIssues, rowEnds, 0, rowAssignees);
                    if (rawCapacityIssues.length > 0) {
                        const excludedRowStart = Math.max(1, rowEnds.length);
                        const excludedRowEnds = [];
                        const excludedRowAssignees = [];
                        assignRows(rawCapacityIssues, excludedRowEnds, excludedRowStart, excludedRowAssignees, { allowAssigneeMix: true });
                        excludedRowEnds.forEach(end => rowEnds.push(end));
                        excludedRowAssignees.forEach(a => rowAssignees.push(a));
                    }
                    laneRowAssignees.set(lane, [...rowAssignees]);
                    const totalRows = Math.max(1, rowEnds.length, capacityRows || 0);
                    const isCollapsed = scenarioEpicFocus ? false : Boolean(scenarioCollapsedLanes[lane]);
                    const collapsedRows = scenarioLaneMode === 'epic'
                        ? 1
                        : (scenarioLaneMode === 'team' && capacityRows
                            ? Math.max(SCENARIO_COLLAPSED_ROWS, capacityRows)
                            : SCENARIO_COLLAPSED_ROWS);
                    const visibleRows = isCollapsed
                        ? Math.min(collapsedRows, totalRows)
                        : totalRows;
                    laneRowCounts.set(lane, totalRows);
                    laneVisibleRows.set(lane, Math.max(1, visibleRows));
                    laneHiddenCounts.set(lane, Math.max(0, totalRows - visibleRows));
                });
                if (perfEnabled) {
                    performance.mark('scenarioLaneStacking:end');
                    performance.measure(
                        'scenarioLaneStacking',
                        'scenarioLaneStacking:start',
                        'scenarioLaneStacking:end'
                    );
                    performance.clearMarks('scenarioLaneStacking:start');
                    performance.clearMarks('scenarioLaneStacking:end');
                    performance.clearMeasures('scenarioLaneStacking');
                }
                return { rowIndexByKey, laneRowCounts, laneVisibleRows, laneHiddenCounts, laneRowAssignees };
            }, [
                scenarioLanes,
                scenarioIssuesByLane,
                scenarioViewStart,
                scenarioCollapsedLanes,
                scenarioLaneMode,
                scenarioCapacityByTeam,
                scenarioExcludedIssueKeys,
                isAllTeamsSelected,
                scenarioEpicFocus,
                perfEnabled
            ]);
            const scenarioVisibleExportIssues = React.useMemo(() => {
                if (!scenarioTimelineWithSegments || scenarioTimelineWithSegments.length === 0) return [];
                return scenarioTimelineWithSegments.filter(issue => {
                    if (!issue?.key) return false;
                    if (scenarioShowConflictsOnly && !scenarioAssigneeConflicts.conflicts.has(issue.key)) return false;
                    const lane = scenarioLaneForIssue(issue);
                    const rowIndex = scenarioLaneStacking.rowIndexByKey.get(issue.key) ?? 0;
                    const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
                    return rowIndex < visibleRows;
                });
            }, [
                scenarioTimelineWithSegments,
                scenarioShowConflictsOnly,
                scenarioAssigneeConflicts,
                scenarioLaneStacking,
                scenarioLaneMode,
                scenarioEpicFocus
            ]);
            const scenarioJiraEpicKeys = React.useMemo(
                () => collectJiraExportKeysFromScenarioIssues(scenarioVisibleExportIssues, 'epics'),
                [scenarioVisibleExportIssues]
            );
            const scenarioJiraStoryKeys = React.useMemo(
                () => collectJiraExportKeysFromScenarioIssues(scenarioVisibleExportIssues, 'stories'),
                [scenarioVisibleExportIssues]
            );
            const scenarioLaneMeta = React.useMemo(() => {
                const meta = new Map();
                let offset = 0;
                scenarioLanes.forEach((lane) => {
                    const totalRows = scenarioLaneStacking.laneRowCounts.get(lane) || 1;
                    const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
                    const hiddenCount = scenarioLaneStacking.laneHiddenCounts.get(lane) || 0;
                    const shouldCollapse = Boolean(scenarioCollapsedLanes[lane]);
                    const isCollapsed = scenarioEpicFocus?.key === lane ? false : shouldCollapse;
                    const rowCount = Math.max(1, visibleRows);
                    const height = rowCount * (SCENARIO_BAR_HEIGHT + scenarioBarGap) + scenarioBarGap;
                    meta.set(lane, { offset, height, rowCount, collapsed: isCollapsed, hiddenCount, totalRows });
                    offset += height;
                });
                return { meta, totalHeight: offset };
            }, [scenarioLanes, scenarioLaneStacking, scenarioCollapsedLanes, scenarioEpicFocus, scenarioBarGap]);
            const scenarioLaneAssigneeGroups = React.useMemo(() => {
                if (scenarioLaneMode !== 'team') return new Map();
                const result = new Map();
                scenarioLanes.forEach((lane) => {
                    const rowAssignees = scenarioLaneStacking.laneRowAssignees?.get(lane) || [];
                    const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
                    const groups = [];
                    let current = null;
                    for (let i = 0; i < Math.min(rowAssignees.length, visibleRows); i++) {
                        const assignee = rowAssignees[i] || null;
                        if (current && current.assignee === assignee) {
                            current.rowCount += 1;
                        } else {
                            current = { assignee, startRow: i, rowCount: 1 };
                            groups.push(current);
                        }
                    }
                    result.set(lane, groups);
                });
                return result;
            }, [scenarioLaneMode, scenarioLanes, scenarioLaneStacking]);
            const areScenarioCollapsedLanesEqual = (a, b) => {
                if (a === b) return true;
                const aKeys = Object.keys(a || {});
                const bKeys = Object.keys(b || {});
                if (aKeys.length !== bKeys.length) return false;
                for (let i = 0; i < aKeys.length; i += 1) {
                    const key = aKeys[i];
                    if (a[key] !== b[key]) return false;
                }
                return true;
            };

            useEffect(() => {
                if (!showScenario) return;
                if (!scenarioIssues.length && !scenarioLanes.length) return;
                if (scenarioSkipAutoCollapseRef.current) {
                    scenarioSkipAutoCollapseRef.current = false;
                    return;
                }
                if (scenarioLaneMode === 'team' && isAllTeamsSelected) {
                    if (!scenarioTeamCollapseInitRef.current) {
                        const next = {};
                        scenarioLanes.forEach(lane => {
                            next[lane] = true;
                        });
                        setScenarioCollapsedLanes(prev => (areScenarioCollapsedLanesEqual(prev, next) ? prev : next));
                        scenarioTeamCollapseInitRef.current = true;
                    }
                    return;
                }
                scenarioTeamCollapseInitRef.current = false;
                if (scenarioLaneMode !== 'epic') {
                    setScenarioCollapsedLanes(prev => (Object.keys(prev || {}).length ? {} : prev));
                    return;
                }
                const next = {};
                scenarioLanes.forEach(lane => {
                    next[lane] = true;
                });
                scenarioIssues.forEach(issue => {
                    if (scenarioFocusSet.size === 0 || scenarioFocusSet.has(issue.key) || scenarioContextSet.has(issue.key)) {
                        next[scenarioLaneForIssue(issue)] = false;
                    }
                });
                setScenarioCollapsedLanes(prev => (areScenarioCollapsedLanesEqual(prev, next) ? prev : next));
            }, [
                showScenario,
                scenarioLaneMode,
                scenarioLanes,
                scenarioIssues,
                scenarioFocusSet,
                scenarioContextSet,
                isAllTeamsSelected
            ]);

            useEffect(() => {
                scenarioTeamCollapseInitRef.current = false;
            }, [scenarioData]);

            useEffect(() => {
                if (!showScenario || !scenarioTimelineRef.current) return;
                const container = scenarioTimelineRef.current;
                const readLayout = () => {
                    if (perfEnabled) {
                        perfCountersRef.current.layoutReads += 1;
                    }
                    const track = container.querySelector('.scenario-lane-track');
                    const containerStyles = window.getComputedStyle(container);
                    const labelWidthValue = parseFloat(containerStyles.getPropertyValue('--scenario-label-width')) || 190;
                    const laneEl = container.querySelector('.scenario-lane');
                    let gapValue = 0;
                    if (laneEl) {
                        const laneStyles = window.getComputedStyle(laneEl);
                        gapValue = parseFloat(laneStyles.columnGap || laneStyles.gap || '0') || 0;
                    }
                    const labelWidth = labelWidthValue + gapValue;
                    const trackWidth = track ? track.clientWidth : Math.max(0, container.clientWidth - labelWidth);
                    let height = scenarioLaneMeta.totalHeight || scenarioLanes.length * SCENARIO_LANE_HEIGHT;
                    setScenarioLayout(prev => {
                        if (prev.width === trackWidth && prev.height === height && prev.labelWidth === labelWidth) {
                            return prev;
                        }
                        return {
                            width: trackWidth,
                            height,
                            labelWidth
                        };
                    });
                    scheduleScenarioEdgeUpdate();
                };
                const readScroll = () => {
                    if (perfEnabled) {
                        perfCountersRef.current.scrollReads += 1;
                    }
                    const nextTop = container.scrollTop || 0;
                    const nextLeft = container.scrollLeft || 0;
                    const nextHeight = container.clientHeight || 0;
                    setScenarioScrollTop(prev => (prev === nextTop ? prev : nextTop));
                    setScenarioScrollLeft(prev => (prev === nextLeft ? prev : nextLeft));
                    setScenarioViewportHeight(prev => (prev === nextHeight ? prev : nextHeight));
                    scheduleScenarioEdgeUpdate();
                };
                const scheduleLayout = () => {
                    if (scenarioResizeFrameRef.current) return;
                    scenarioResizeFrameRef.current = window.requestAnimationFrame(() => {
                        scenarioResizeFrameRef.current = null;
                        if (!scenarioTimelineRef.current) return;
                        readLayout();
                    });
                };
                const scheduleScroll = () => {
                    if (scenarioScrollFrameRef.current) return;
                    scenarioScrollFrameRef.current = window.requestAnimationFrame(() => {
                        scenarioScrollFrameRef.current = null;
                        if (!scenarioTimelineRef.current) return;
                        readScroll();
                    });
                };
                scheduleLayout();
                scheduleScroll();
                container.addEventListener('scroll', scheduleScroll, { passive: true });
                window.addEventListener('resize', scheduleLayout);
                window.addEventListener('resize', scheduleScroll);
                return () => {
                    container.removeEventListener('scroll', scheduleScroll);
                    window.removeEventListener('resize', scheduleLayout);
                    window.removeEventListener('resize', scheduleScroll);
                    if (scenarioScrollFrameRef.current) {
                        window.cancelAnimationFrame(scenarioScrollFrameRef.current);
                        scenarioScrollFrameRef.current = null;
                    }
                    if (scenarioResizeFrameRef.current) {
                        window.cancelAnimationFrame(scenarioResizeFrameRef.current);
                        scenarioResizeFrameRef.current = null;
                    }
                };
            }, [showScenario, scenarioLanes.length, scenarioData, scenarioLaneMode, scenarioIssuesByLane, scenarioLaneMeta, scheduleScenarioEdgeUpdate, perfEnabled]);

            const scenarioPositions = React.useMemo(() => {
                if (!scenarioViewStart || !scenarioViewEnd) return {};
                if (!scenarioLayout.width) return {};
                const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
                const positions = {};

                // Debug: Log Accepted tasks positioning to diagnose left-of-TODAY bug
                if (process.env.NODE_ENV === 'development') {
                    const acceptedTasks = scenarioTimelineIssues.filter(i => i.status === 'Accepted');
                    if (acceptedTasks.length > 0) {
                        console.debug('[Scenario] Accepted tasks:', acceptedTasks.map(i => ({
                            key: i.key,
                            start: i.start,
                            end: i.end,
                            scheduledReason: i.scheduledReason
                        })));
                        console.debug('[Scenario] View range:', {
                            start: scenarioViewStart,
                            end: scenarioViewEnd,
                            today: new Date()
                        });
                    }
                }

                scenarioTimelineWithSegments.forEach((issue) => {
                    const lane = scenarioLaneForIssue(issue);
                    const laneMeta = scenarioLaneMeta.meta.get(lane);
                    if (!laneMeta) return;
                    const rowIndex = scenarioLaneStacking.rowIndexByKey.get(issue.key) ?? 0;
                    const visibleRows = scenarioLaneStacking.laneVisibleRows.get(lane) || 1;
                    if (rowIndex >= visibleRows) return;
                    const y = laneMeta.offset + scenarioBarGap + rowIndex * (SCENARIO_BAR_HEIGHT + scenarioBarGap);
                    if (!issue.start || !issue.end) {
                        const width = Math.min(80, scenarioLayout.width * 0.12);
                        positions[issue.key] = {
                            xStart: 0,
                            xEnd: width,
                            y,
                            height: SCENARIO_BAR_HEIGHT,
                            lane
                        };
                        return;
                    }
                    const start = parseScenarioDate(issue.start);
                    const end = parseScenarioDate(issue.end);
                    if (!start || !end) return;
                    const startRatio = Math.max(0, (start - scenarioViewStart) / totalMs);
                    const endRatio = Math.min(1, (end - scenarioViewStart) / totalMs);
                    const xStart = startRatio * scenarioLayout.width;
                    const xEnd = Math.max(xStart + 6, endRatio * scenarioLayout.width);
                    positions[issue.key] = {
                        xStart,
                        xEnd,
                        y,
                        height: SCENARIO_BAR_HEIGHT,
                        lane
                    };
                });
                return positions;
            }, [
                scenarioTimelineWithSegments,
                scenarioViewStart,
                scenarioViewEnd,
                scenarioLayout,
                scenarioLanes,
                scenarioLaneMeta,
                scenarioBarGap,
                scenarioLaneStacking
            ]);

            const scenarioEdgeCandidates = React.useMemo(() => {
                return (scenarioDependencies || []).filter(edge =>
                    edge?.from &&
                    edge?.to &&
                    scenarioTimelineIssueKeys.has(edge.from) &&
                    scenarioTimelineIssueKeys.has(edge.to)
                );
            }, [scenarioDependencies, scenarioTimelineIssueKeys]);

            const scenarioEdgeIndex = React.useMemo(() => {
                const incoming = new Map();
                const outgoing = new Map();
                scenarioEdgeCandidates.forEach(edge => {
                    if (!incoming.has(edge.to)) {
                        incoming.set(edge.to, new Set());
                    }
                    if (!outgoing.has(edge.from)) {
                        outgoing.set(edge.from, new Set());
                    }
                    incoming.get(edge.to).add(edge.from);
                    outgoing.get(edge.from).add(edge.to);
                });
                return { incoming, outgoing };
            }, [scenarioEdgeCandidates]);

            const scenarioEpicBars = React.useMemo(() => {
                if (scenarioLaneMode !== 'epic') return [];
                if (!scenarioViewStart || !scenarioViewEnd) return [];
                const bars = [];
                const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
                scenarioLanes.forEach((lane) => {
                    const laneIssues = scenarioIssuesByLane.get(lane) || [];
                    const epicGroups = new Map();
                    laneIssues.forEach((issue) => {
                        const epicKey = issue.epicKey;
                        if (!epicKey) return;
                        if (!epicGroups.has(epicKey)) {
                            epicGroups.set(epicKey, []);
                        }
                        epicGroups.get(epicKey).push(issue);
                    });
                    epicGroups.forEach((issues, epicKey) => {
                        if (scenarioEpicFocus?.key && epicKey !== scenarioEpicFocus.key) return;
                        let start = null;
                        let end = null;
                        let storyPoints = 0;
                        const assigneeSet = new Set();
                        issues.forEach((issue) => {
                            const startDate = parseScenarioDate(issue.start);
                            const endDate = parseScenarioDate(issue.end);
                            if (!startDate || !endDate) return;
                            if (!start || startDate < start) start = startDate;
                            if (!end || endDate > end) end = endDate;
                            if (Number.isFinite(issue.sp)) {
                                storyPoints += Number(issue.sp);
                            }
                            if (issue.assignee) {
                                assigneeSet.add(issue.assignee);
                            }
                        });
                        if (!start || !end) return;
                        const startRatio = Math.max(0, (start - scenarioViewStart) / totalMs);
                        const endRatio = Math.min(1, (end - scenarioViewStart) / totalMs);
                        const xStart = startRatio * scenarioLayout.width;
                        const xEnd = Math.max(xStart + 6, endRatio * scenarioLayout.width);
                        const laneMeta = scenarioLaneMeta.meta.get(lane) || { offset: 0, height: SCENARIO_LANE_HEIGHT };
                        const assignees = Array.from(assigneeSet);
                        bars.push({
                            lane,
                            epicKey,
                            epicSummary: scenarioIssueByKey.get(issues[0].key)?.epicSummary,
                            storyPoints,
                            assignees,
                            xStart,
                            xEnd,
                            y: laneMeta.offset + 3,
                            height: laneMeta.height - 6,
                            isExcluded: excludedEpicSet.has(normalizeEpicKey(epicKey))
                        });
                    });
                });
                return bars;
            }, [scenarioIssuesByLane, scenarioLanes, scenarioLaneMode, scenarioViewStart, scenarioViewEnd, scenarioLayout, scenarioLaneMeta, scenarioIssueByKey, scenarioEpicFocus, excludedEpicSet]);

            const scenarioEpicEdges = React.useMemo(() => {
                if (scenarioLaneMode !== 'epic' || scenarioEpicFocus) return [];
                const grouped = new Map();
                (scenarioDependencies || []).forEach(edge => {
                    const fromIssue = scenarioIssueByKey.get(edge.from);
                    const toIssue = scenarioIssueByKey.get(edge.to);
                    if (!fromIssue || !toIssue) return;
                    const fromEpic = fromIssue.epicKey || 'No Epic';
                    const toEpic = toIssue.epicKey || 'No Epic';
                    if (fromEpic === toEpic) return;
                    const key = `${fromEpic}::${toEpic}`;
                    const current = grouped.get(key) || { fromEpic, toEpic, count: 0 };
                    current.count += 1;
                    grouped.set(key, current);
                });
                const edges = [];
                grouped.forEach((entry) => {
                    const fromMeta = scenarioLaneMeta.meta.get(entry.fromEpic);
                    const toMeta = scenarioLaneMeta.meta.get(entry.toEpic);
                    if (!fromMeta || !toMeta) return;
                    edges.push({
                        fromEpic: entry.fromEpic,
                        toEpic: entry.toEpic,
                        count: entry.count,
                        y1: fromMeta.offset + fromMeta.height / 2,
                        y2: toMeta.offset + toMeta.height / 2,
                    });
                });
                return edges;
            }, [scenarioDependencies, scenarioLaneMeta, scenarioLaneMode, scenarioIssueByKey]);

            const scenarioDeadlineLeft = React.useMemo(() => {
                if (!scenarioViewStart || !scenarioViewEnd || !scenarioDeadline) return 0;
                if (!scenarioLayout.width) return 0;
                const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
                const ratio = Math.max(0, Math.min(1, (scenarioDeadline - scenarioViewStart) / totalMs));
                return scenarioLayout.labelWidth + scenarioLayout.width * ratio;
            }, [scenarioViewStart, scenarioViewEnd, scenarioDeadline, scenarioLayout]);

            const scenarioTodayLeft = React.useMemo(() => {
                if (!scenarioViewStart || !scenarioViewEnd) return null;
                if (!scenarioLayout.width) return null;
                const today = new Date();
                today.setHours(0, 0, 0, 0); // Start of today
                const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
                const ratio = (today - scenarioViewStart) / totalMs;
                // Only show if today is within the visible range
                if (ratio < 0 || ratio > 1) return null;
                return scenarioLayout.labelWidth + scenarioLayout.width * ratio;
            }, [scenarioViewStart, scenarioViewEnd, scenarioLayout]);

            const scenarioVisibleLanes = React.useMemo(() => {
                if (!scenarioViewportHeight) return scenarioLanes;
                const buffer = 80;
                const start = scenarioScrollTop - buffer;
                const end = scenarioScrollTop + scenarioViewportHeight + buffer;
                return scenarioLanes.filter(lane => {
                    const meta = scenarioLaneMeta.meta.get(lane);
                    if (!meta) return false;
                    return meta.offset + meta.height >= start && meta.offset <= end;
                });
            }, [scenarioLanes, scenarioLaneMeta, scenarioScrollTop, scenarioViewportHeight]);

            const scenarioActiveEdges = React.useMemo(() => {
                if (!scenarioHoverKey) return [];
                return scenarioEdgeCandidates.filter(edge => edge.from === scenarioHoverKey || edge.to === scenarioHoverKey);
            }, [scenarioEdgeCandidates, scenarioHoverKey]);

            const scenarioUpstreamSet = React.useMemo(() => {
                if (!scenarioHoverKey) return new Set();
                return new Set(scenarioEdgeIndex.incoming.get(scenarioHoverKey) || []);
            }, [scenarioHoverKey, scenarioEdgeIndex]);

            const scenarioDownstreamSet = React.useMemo(() => {
                if (!scenarioHoverKey) return new Set();
                return new Set(scenarioEdgeIndex.outgoing.get(scenarioHoverKey) || []);
            }, [scenarioHoverKey, scenarioEdgeIndex]);

            const scenarioBlockedSet = React.useMemo(() => {
                const blocked = new Set();
                (scenarioDependencies || []).forEach(edge => {
                    if (edge.type === 'block' && edge.to) {
                        blocked.add(edge.to);
                    }
                });
                return blocked;
            }, [scenarioDependencies]);

            const scenarioIsSingleTeamFocus = !isAllTeamsSelected && selectedTeamSet.size === 1;
            const scenarioBaselineEdges = React.useMemo(() => {
                return scenarioEdgeCandidates;
            }, [scenarioEdgeCandidates]);

            const scenarioFocusEdges = React.useMemo(() => {
                if (!scenarioEpicFocus) return [];
                const inside = [];
                const context = [];
                scenarioEdgeCandidates.forEach(edge => {
                    const fromIn = scenarioFocusIssueKeys.has(edge.from);
                    const toIn = scenarioFocusIssueKeys.has(edge.to);
                    if (fromIn && toIn) {
                        inside.push(edge);
                        return;
                    }
                    const fromContext = scenarioFocusContextKeys.has(edge.from);
                    const toContext = scenarioFocusContextKeys.has(edge.to);
                    if ((fromIn && toContext) || (toIn && fromContext)) {
                        context.push(edge);
                    }
                });
                return [...context, ...inside];
            }, [scenarioEpicFocus, scenarioEdgeCandidates, scenarioFocusIssueKeys, scenarioFocusContextKeys]);


            const toggleScenarioLane = (lane) => {
                setScenarioCollapsedLanes(prev => ({
                    ...prev,
                    [lane]: !prev?.[lane]
                }));
            };



            const areScenarioEdgeRendersEqual = (prev, next) => {
                if (prev.width !== next.width || prev.height !== next.height) return false;
                if (prev.paths.length !== next.paths.length) return false;
                for (let i = 0; i < prev.paths.length; i += 1) {
                    const a = prev.paths[i];
                    const b = next.paths[i];
                    if (a.id !== b.id) return false;
                    if (a.d !== b.d) return false;
                    if (a.isActive !== b.isActive) return false;
                    if (a.isFaded !== b.isFaded) return false;
                    if (a.isContextEdge !== b.isContextEdge) return false;
                    if (a.type !== b.type) return false;
                }
                return true;
            };

            const computeScenarioTooltipPosition = (anchor) => {
                const fallback = { width: 240, height: 56 };
                const tooltipNode = scenarioTooltipRef.current;
                const measured = tooltipNode?.getBoundingClientRect?.();
                const tooltipWidth = measured?.width || fallback.width;
                const tooltipHeight = measured?.height || fallback.height;
                const rect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
                if (!rect) {
                    return { x: 0, y: 0 };
                }
                const padding = 12;
                const offset = 10;
                let x = rect.right + offset;
                let y = rect.top - tooltipHeight - offset;
                if (y < padding) {
                    y = rect.bottom + offset;
                }
                if (x + tooltipWidth > window.innerWidth - padding) {
                    x = rect.left - tooltipWidth - offset;
                }
                if (x < padding) {
                    x = padding;
                }
                if (y + tooltipHeight > window.innerHeight - padding) {
                    y = Math.max(padding, window.innerHeight - padding - tooltipHeight);
                }
                return { x, y };
            };

            const showScenarioTooltip = (event, payload) => {
                if (!payload) return;
                const anchor = event?.currentTarget;
                scenarioTooltipAnchorRef.current = anchor || null;
                const anchorRect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
                const position = computeScenarioTooltipPosition(anchorRect || {
                    left: event.clientX,
                    right: event.clientX,
                    top: event.clientY,
                    bottom: event.clientY,
                    width: 0,
                    height: 0
                });
                setScenarioTooltip({
                    ...payload,
                    visible: true,
                    x: position.x,
                    y: position.y
                });
            };

            const showScenarioTooltipFromElement = (element, payload) => {
                if (!element || !payload) return;
                scenarioTooltipAnchorRef.current = element;
                const rect = element.getBoundingClientRect();
                const position = computeScenarioTooltipPosition(rect);
                setScenarioTooltip({
                    ...payload,
                    visible: true,
                    x: position.x,
                    y: position.y
                });
            };

            const moveScenarioTooltip = () => {
                const anchor = scenarioTooltipAnchorRef.current;
                if (!anchor) return;
                setScenarioTooltip(prev => {
                    if (!prev.visible) return prev;
                    const position = computeScenarioTooltipPosition(anchor);
                    if (position.x === prev.x && position.y === prev.y) return prev;
                    return {
                        ...prev,
                        x: position.x,
                        y: position.y
                    };
                });
            };

            const hideScenarioTooltip = () => {
                scenarioTooltipAnchorRef.current = null;
                setScenarioTooltip(prev => (prev.visible ? { ...prev, visible: false } : prev));
            };

            const computeScenarioEdgePaths = React.useCallback(() => {
                if (perfEnabled) {
                    perfCountersRef.current.edgeComputes += 1;
                    performance.mark('scenarioEdgeCompute:start');
                }
                const container = scenarioTimelineRef.current;
                if (!container) {
                    return { width: 0, height: 0, paths: [] };
                }
                const containerRect = container.getBoundingClientRect();
                const scrollLeft = container.scrollLeft || 0;
                const scrollTop = container.scrollTop || 0;
                const visibleRects = new Map();
                const visibleKeys = new Set();
                scenarioIssueRefMap.current.forEach((node, key) => {
                    if (!node || !node.getBoundingClientRect) return;
                    const rect = node.getBoundingClientRect();
                    visibleRects.set(key, {
                        x: rect.left - containerRect.left + scrollLeft,
                        y: rect.top - containerRect.top + scrollTop,
                        width: rect.width,
                        height: rect.height
                    });
                    visibleKeys.add(key);
                });

                const lanes = container.querySelector('.scenario-lanes');
                const track = container.querySelector('.scenario-lane-track');
                const lanesRect = lanes ? lanes.getBoundingClientRect() : null;
                const trackRect = track ? track.getBoundingClientRect() : null;
                const lanesTop = lanesRect ? lanesRect.top - containerRect.top + scrollTop : 0;
                const trackLeft = trackRect ? trackRect.left - containerRect.left + scrollLeft : (scenarioLayout.labelWidth || 0);

                const getFallbackRect = (issueKey) => {
                    const pos = scenarioPositions[issueKey];
                    if (!pos) return null;
                    return {
                        x: trackLeft + pos.xStart,
                        y: lanesTop + pos.y,
                        width: Math.max(2, pos.xEnd - pos.xStart),
                        height: pos.height
                    };
                };

                const baseEdges = scenarioHoverKey
                    ? (scenarioEpicFocus ? scenarioFocusEdges : scenarioEdgeCandidates)
                    : (scenarioEpicFocus ? scenarioFocusEdges : scenarioBaselineEdges);
                const edgeMap = new Map();
                baseEdges.forEach(edge => {
                    edgeMap.set(`${edge.from}-${edge.to}-${edge.type || 'link'}`, edge);
                });
                if (scenarioHoverKey) {
                    scenarioActiveEdges.forEach(edge => {
                        edgeMap.set(`${edge.from}-${edge.to}-${edge.type || 'link'}`, edge);
                    });
                }

                const paths = [];
                edgeMap.forEach((edge) => {
                    const fromVisible = visibleKeys.has(edge.from);
                    const toVisible = visibleKeys.has(edge.to);
                    if (!fromVisible && !toVisible) return;
                    const fromRect = visibleRects.get(edge.from) || getFallbackRect(edge.from);
                    const toRect = visibleRects.get(edge.to) || getFallbackRect(edge.to);
                    // Active Sprint anchor + dependency visualization: Edges must never render when endpoints are missing
                    // This prevents edges from "shooting to the end" or landing on wrong bar positions
                    if (!fromRect || !toRect) {
                        if (process.env.NODE_ENV === 'development') {
                            console.debug(`[Scenario] Skipped edge ${edge.from} → ${edge.to}: missing rect`, {
                                fromRect: !!fromRect,
                                toRect: !!toRect,
                                fromInPositions: !!scenarioPositions[edge.from],
                                toInPositions: !!scenarioPositions[edge.to]
                            });
                        }
                        return;
                    }
                    const fromInFocus = scenarioEpicFocus && scenarioFocusIssueKeys.has(edge.from);
                    const toInFocus = scenarioEpicFocus && scenarioFocusIssueKeys.has(edge.to);
                    if (scenarioEpicFocus && !fromInFocus && !toInFocus) {
                        return;
                    }

                    const startX = fromRect.x + fromRect.width;
                    const endX = toRect.x;

                    // Timeline dependency waterflow: Only show edges that flow forward in time
                    // On a timeline, backward arrows (right-to-left) make no sense
                    // Skip edges where prerequisite is scheduled AFTER dependent (backward in time)
                    if (endX <= startX) {
                        // Dependent is to the LEFT of or same position as prerequisite (backward/parallel)
                        // This happens with circular dependencies in Jira data
                        // Skip to avoid visual clutter and maintain left-to-right waterflow
                        if (process.env.NODE_ENV === 'development') {
                            console.debug(`[Scenario] Skipped backward edge ${edge.from} → ${edge.to}: endX=${endX.toFixed(0)} <= startX=${startX.toFixed(0)}`);
                        }
                        return;
                    }
                    const startY = fromRect.y + fromRect.height / 2;
                    const endY = toRect.y + toRect.height / 2;
                    const dx = endX - startX;
                    let c1x;
                    let c2x;
                    if (dx >= 0) {
                        const curve = Math.min(140, Math.max(20, dx * 0.5));
                        const safeCurve = Math.min(curve, Math.max(10, dx));
                        c1x = startX + safeCurve;
                        c2x = endX - safeCurve;
                    } else {
                        const overlap = Math.abs(dx);
                        const curve = Math.min(200, Math.max(60, overlap * 0.8));
                        const midX = Math.min(container.scrollWidth || container.clientWidth, startX + curve);
                        c1x = midX;
                        c2x = midX;
                    }
                    const isActive = scenarioHoverKey && (edge.from === scenarioHoverKey || edge.to === scenarioHoverKey);
                    const isFaded = scenarioHoverKey && !isActive;
                    const isContextEdge = !isActive && scenarioEpicFocus && ((fromInFocus && !toInFocus) || (!fromInFocus && toInFocus));
                    paths.push({
                        id: `${edge.from}-${edge.to}-${edge.type || 'link'}`,
                        from: edge.from,
                        to: edge.to,
                        d: `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`,
                        type: edge.type,
                        isActive,
                        isFaded,
                        isContextEdge
                    });
                });
                const result = {
                    width: container.scrollWidth || container.clientWidth,
                    height: container.scrollHeight || container.clientHeight,
                    paths
                };
                if (perfEnabled) {
                    performance.mark('scenarioEdgeCompute:end');
                    performance.measure(
                        'scenarioEdgeCompute',
                        'scenarioEdgeCompute:start',
                        'scenarioEdgeCompute:end'
                    );
                    performance.clearMarks('scenarioEdgeCompute:start');
                    performance.clearMarks('scenarioEdgeCompute:end');
                    performance.clearMeasures('scenarioEdgeCompute');
                }
                return result;
            }, [
                scenarioTimelineIssueKeys,
                scenarioEpicFocus,
                scenarioEdgeCandidates,
                scenarioFocusEdges,
                scenarioBaselineEdges,
                scenarioActiveEdges,
                scenarioHoverKey,
                scenarioFocusIssueKeys,
                scenarioPositions,
                scenarioLayout.labelWidth,
                perfEnabled
            ]);

            const clearScenarioEpicFocus = () => {
                if (!scenarioEpicFocus) return;
                const restore = scenarioFocusRestoreRef.current;
                setScenarioEpicFocus(null);
                hideScenarioTooltip();
                setScenarioRangeOverride(restore?.rangeOverride || null);
                if (restore?.laneMode === 'epic') {
                    scenarioSkipAutoCollapseRef.current = true;
                }
                if (restore?.laneMode && restore.laneMode !== scenarioLaneMode) {
                    setScenarioLaneMode(restore.laneMode);
                }
                if (restore?.collapsedLanes) {
                    setScenarioCollapsedLanes(restore.collapsedLanes);
                }
                if (scenarioTimelineRef.current && typeof restore?.scrollTop === 'number') {
                    scenarioTimelineRef.current.scrollTo({ top: restore.scrollTop, behavior: 'auto' });
                }
                scenarioFocusRestoreRef.current = null;
            };

            const focusScenarioEpic = (epicKey, epicSummary) => {
                if (!epicKey) return;
                if (scenarioEpicFocus?.key === epicKey) {
                    clearScenarioEpicFocus();
                    return;
                }
                if (!scenarioEpicFocus) {
                    scenarioFocusRestoreRef.current = {
                        laneMode: scenarioLaneMode,
                        collapsedLanes: { ...scenarioCollapsedLanes },
                        scrollTop: scenarioTimelineRef.current?.scrollTop || 0,
                        rangeOverride: scenarioRangeOverride
                    };
                }
                const cleanedSummary = normalizeScenarioSummary(epicSummary) || epicKey;
                setScenarioEpicFocus({ key: epicKey, summary: cleanedSummary });
                if (scenarioLaneMode !== 'epic') {
                    setScenarioLaneMode('epic');
                }
                const DAY_MS = 24 * 60 * 60 * 1000;
                let minStart = null;
                let maxEnd = null;
                scenarioIssues.forEach(issue => {
                    if (issue.epicKey !== epicKey) return;
                    const start = parseScenarioDate(issue.start);
                    const end = parseScenarioDate(issue.end);
                    if (!start || !end) return;
                    if (!minStart || start < minStart) minStart = start;
                    if (!maxEnd || end > maxEnd) maxEnd = end;
                });
                if (minStart && maxEnd) {
                    const span = Math.max(1, maxEnd - minStart);
                    const padding = Math.max(DAY_MS * 2, span * 0.06);
                    setScenarioRangeOverride({
                        start: new Date(minStart.getTime() - padding),
                        end: new Date(maxEnd.getTime() + padding)
                    });
                } else {
                    setScenarioRangeOverride(null);
                }
            };

            scheduleScenarioEdgeUpdate = React.useCallback(() => {
                if (!showScenario) return;
                if (document.hidden) return;
                if (perfEnabled) {
                    perfCountersRef.current.edgeRequests += 1;
                }
                if (scenarioEdgeFrameRef.current) return;
                if (scenarioEdgeUpdatePendingRef.current) return;
                scenarioEdgeUpdatePendingRef.current = true;
                scenarioEdgeFrameRef.current = window.requestAnimationFrame(() => {
                    scenarioEdgeFrameRef.current = null;
                    scenarioEdgeUpdatePendingRef.current = false;
                    if (perfEnabled) {
                        perfCountersRef.current.edgeFrames += 1;
                    }
                    const nextRender = computeScenarioEdgePaths();
                    setScenarioEdgeRender(prev => (areScenarioEdgeRendersEqual(prev, nextRender) ? prev : nextRender));
                });
            }, [computeScenarioEdgePaths, showScenario, perfEnabled]);

            useEffect(() => {
                scheduleScenarioEdgeUpdate();
            }, [
                scenarioLaneMode,
                scenarioCollapsedLanes,
                scenarioRangeOverride,
                scenarioEpicFocus,
                scenarioLayout.width,
                scenarioLayout.height,
                scenarioLaneStacking,
                scheduleScenarioEdgeUpdate
            ]);

            useEffect(() => {
                if (!showScenario) return;
                scheduleScenarioEdgeUpdate();
            }, [showScenario, scenarioPositions, scenarioVisibleLanes, scheduleScenarioEdgeUpdate]);

            useEffect(() => {
                scheduleScenarioEdgeUpdate();
            }, [
                scenarioHoverKey,
                scenarioBaselineEdges,
                scenarioFocusEdges,
                scenarioActiveEdges,
                scenarioTimelineIssueKeys,
                scheduleScenarioEdgeUpdate
            ]);

            const scrollToScenarioIssue = (issueKey) => {
                if (scenarioEpicFocus) {
                    scenarioPendingScrollRef.current = issueKey;
                    clearScenarioEpicFocus();
                    return;
                }
                const issue = scenarioIssueByKey.get(issueKey);
                if (!issue || !scenarioTimelineRef.current) return;

                // First, scroll the main window to bring timeline into view
                const container = scenarioTimelineRef.current;
                const containerTop = container.getBoundingClientRect().top + window.scrollY;
                window.scrollTo({ top: containerTop - 100, behavior: 'smooth' });

                const lane = scenarioLaneForIssue(issue);
                if (scenarioLaneMode === 'epic') {
                    setScenarioCollapsedLanes(prev => ({ ...prev, [lane]: false }));
                }
                const position = scenarioPositions[issueKey];
                if (!position) return;

                // Then scroll within the timeline to the specific task
                const axis = container.querySelector('.scenario-axis');
                const axisOffset = axis ? axis.offsetHeight : 0;
                const targetTop = Math.max(0, position.y + axisOffset - container.clientHeight / 2);

                // Delay the timeline scroll slightly to allow page scroll to start
                window.setTimeout(() => {
                    container.scrollTo({ top: targetTop, behavior: 'smooth' });
                }, 100);

                setScenarioFlashKey(issueKey);
                window.setTimeout(() => {
                    setScenarioFlashKey(current => (current === issueKey ? null : current));
                }, 1400);
            };

            useEffect(() => {
                if (scenarioEpicFocus) return;
                const pendingKey = scenarioPendingScrollRef.current;
                if (!pendingKey) return;
                if (!scenarioPositions[pendingKey]) return;
                scenarioPendingScrollRef.current = null;
                scrollToScenarioIssue(pendingKey);
            }, [scenarioEpicFocus, scenarioPositions]);

            useEffect(() => {
                if (!scenarioEpicFocus || !scenarioTimelineRef.current) return;
                const laneMeta = scenarioLaneMeta.meta.get(scenarioEpicFocus.key);
                if (!laneMeta) return;
                const container = scenarioTimelineRef.current;
                const axis = container.querySelector('.scenario-axis');
                const axisOffset = axis ? axis.offsetHeight : 0;
                const targetTop = Math.max(0, laneMeta.offset - axisOffset);
                container.scrollTo({ top: targetTop, behavior: 'auto' });
            }, [scenarioEpicFocus, scenarioLaneMeta]);

            useEffect(() => {
                if (!scenarioEpicFocus) return;
                const handleKey = (event) => {
                    if (event.key === 'Escape') {
                        clearScenarioEpicFocus();
                    }
                };
                window.addEventListener('keydown', handleKey);
                return () => {
                    window.removeEventListener('keydown', handleKey);
                };
            }, [scenarioEpicFocus]);

            useEffect(() => {
                if (isFutureSprintSelected && showStats) {
                    setShowStats(false);
                }
            }, [isFutureSprintSelected, showStats]);

            const baseFilteredTasks = React.useMemo(() => {
                const query = searchQuery.trim().toLowerCase();
                return tasks.filter(task => {
                    // Filter by search query
                    if (query !== '') {
	                    const summary = task.fields.summary?.toLowerCase() || '';
	                    const key = String(task.key || '').toLowerCase();
	                    const assignee = task.fields.assignee?.displayName?.toLowerCase() || '';
                        const epicKey = String(task.fields.epicKey || '').toLowerCase();
                        const epicSummary = task.fields.epicKey ? (epicDetails[task.fields.epicKey]?.summary?.toLowerCase() || '') : '';
                        const epicAssignee = task.fields.epicKey ? (epicDetails[task.fields.epicKey]?.assignee?.displayName?.toLowerCase() || '') : '';

                        if (!summary.includes(query) && !key.includes(query) && !assignee.includes(query) &&
                            !epicAssignee.includes(query) && !epicKey.includes(query) && !epicSummary.includes(query)) {
                            return false;
                        }
                    }

                    // Filter by Team
                    if (!isAllTeamsSelected) {
                        const teamInfo = getTeamInfo(task);
                        if (!selectedTeamSet.has(teamInfo.id)) {
                            return false;
                        }
                    }

                    // Filter by Killed status
                    if (!showKilled && task.fields.status?.name === 'Killed') {
                        return false;
                    }

                    // Filter by Done/Incomplete status
                    if (!showDone && (task.fields.status?.name === 'Done' || normalizeStatus(task.fields.status?.name) === 'incomplete')) {
                        return false;
                    }

                    // Filter by task type
                    const isTech = techProjectKeys.has(task.fields?.projectKey || task.key.split('-')[0]);
                    if (isTech && !showTech) {
                        return false;
                    }
                    if (!isTech && !showProduct) {
                        return false;
                    }
                    return true;
                });
            }, [
                tasks,
                searchQuery,
                epicDetails,
                isAllTeamsSelected,
                selectedTeamSet,
                showKilled,
                showDone,
                showTech,
                showProduct
            ]);

            const selectionTasks = baseFilteredTasks;

            useEffect(() => {
                if (!planningScopeKey || !activeGroupId || selectedSprint === null) return;
                if (!tasksFetched || productTasksLoading || techTasksLoading) return;

                const validTaskKeySet = new Set(
                    (selectionTasks || [])
                        .map(task => String(task?.key || '').trim())
                        .filter(Boolean)
                );
                const validTeamIds = teamOptions
                    .map(team => String(team?.id || '').trim())
                    .filter(id => id && id !== 'all');

                const nextSelectedTaskKeys = Object.keys(selectedTasks || {})
                    .filter(key => selectedTasks[key] && validTaskKeySet.has(key))
                    .sort();
                const nextSelectedTeams = sanitizeSelectedTeamsForScope(selectedTeams, {
                    activeGroupTeamIds,
                    availableTeamIds: validTeamIds
                });

                setSelectedTasks(prev => {
                    const prevKeys = Object.keys(prev || {})
                        .filter(key => prev[key] && validTaskKeySet.has(key))
                        .sort();
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

                savePlanningState(window.localStorage, planningScopeKey, {
                    selectedTaskKeys: nextSelectedTaskKeys,
                    selectedTeams: nextSelectedTeams
                });
            }, [
                planningScopeKey,
                activeGroupId,
                selectedSprint,
                tasksFetched,
                productTasksLoading,
                techTasksLoading,
                selectionTasks,
                teamOptions,
                selectedTasks,
                selectedTeams,
                activeGroupTeamIds.join('|')
            ]);

            const visibleTasks = React.useMemo(() => {
                return baseFilteredTasks.filter(task => {
                    // Filter by status (from clickable elements)
                    if (statusFilter === 'in-progress') {
                        return task.fields.status?.name === 'In Progress';
                    }
                    if (statusFilter === 'todo-accepted') {
                        const status = task.fields.status?.name;
                        return status === 'To Do' || status === 'Pending' || status === 'Accepted';
                    }
                    if (statusFilter === 'done') {
                        return task.fields.status?.name === 'Done';
                    }
                    if (statusFilter === 'high-priority') {
                        const priority = task.fields.priority?.name;
                        return priority === 'Blocker' || priority === 'Highest' ||
                               priority === 'Critical' || priority === 'High';
                    }
                    if (statusFilter === 'minor-priority') {
                        const priority = task.fields.priority?.name;
                        return priority === 'Minor' || priority === 'Low' ||
                               priority === 'Trivial' || priority === 'Lowest';
                    }
                    return true;
                });
            }, [baseFilteredTasks, statusFilter]);
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
                resolveTeamColor,
                isClosedStatus: isBurnoutClosedStatus
            }), [
                burnoutData,
                burnoutAssigneeFilter,
                burnoutTaskTeamByIssueKey,
                burnoutTaskStatusByIssueKey,
                burnoutIssueWeightByKey,
                isCompletedSprintSelected,
                burndownMetric,
                isBurnoutClosedStatus
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
            const canRenderStatsPanel = Boolean(effectiveStatsData) || statsView === 'burnout' || statsView === 'cohort' || statsView === 'excludedCapacity' || statsView === 'monoCrossShare';
            const isLeadTimesFocusMode = showStats && statsView === 'cohort';
            const shouldRenderEngTaskList = selectedView === 'eng' && !isStatsSourceOnlyStatsView;
            const groupTasksByEpic = (taskList) => {
                const grouped = {};
                taskList.forEach(task => {
                    const epicKey = task.fields.epicKey || 'NO_EPIC';
                    if (!grouped[epicKey]) {
                        if (epicOrderRef.current[epicKey] === undefined) {
                            epicOrderRef.current[epicKey] = epicOrderCounterRef.current++;
                        }
                        grouped[epicKey] = {
                            epic: epicDetails[epicKey] || null,
                            key: epicKey,
                            tasks: [],
                            storyPoints: 0,
                            parentSummary: task.fields.parentSummary || null
                        };
                    }

                    grouped[epicKey].tasks.push(task);
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    if (!Number.isNaN(sp)) {
                        grouped[epicKey].storyPoints += sp;
                    }
                    if (!grouped[epicKey].parentSummary && task.fields.parentSummary) {
                        grouped[epicKey].parentSummary = task.fields.parentSummary;
                    }
                });
                return grouped;
            };

            const groupEpicsByInitiative = (epicGroupsArray) => {
                const initiativeMap = {};
                const noInitiative = [];

                epicGroupsArray.forEach(eg => {
                    const initiative = epicDetails[eg.key]?.initiative;
                    if (initiative && initiative.key) {
                        if (!initiativeMap[initiative.key]) {
                            initiativeMap[initiative.key] = {
                                initiative,
                                epicGroups: [],
                            };
                        }
                        initiativeMap[initiative.key].epicGroups.push(eg);
                    } else {
                        noInitiative.push(eg);
                    }
                });

                const result = Object.values(initiativeMap);
                if (noInitiative.length > 0) {
                    result.push({ initiative: null, epicGroups: noInitiative });
                }
                return result;
            };

            const epicGroups = React.useMemo(() => {
                return Object.values(groupTasksByEpic(visibleTasksForList))
                    .sort((a, b) => (epicOrderRef.current[a.key] ?? 999999) - (epicOrderRef.current[b.key] ?? 999999));
            }, [visibleTasksForList, epicDetails]);

            const hasInitiativeData = React.useMemo(() => {
                return epicGroups.some(eg => epicDetails[eg.key]?.initiative);
            }, [epicGroups, epicDetails]);

            useEffect(() => {
                setGroupByInitiative(hasInitiativeData);
            }, [hasInitiativeData]);

            const initiativeGroups = React.useMemo(() => {
                if (!groupByInitiative) return null;
                return groupEpicsByInitiative(epicGroups);
            }, [groupByInitiative, epicGroups, epicDetails]);

            useEffect(() => {
                const computeStickyEpicFocus = () => {
                    stickyEpicFrameRef.current = null;
                    const stickyTop = Math.max(0, Number((compactStickyVisible ? compactHeaderOffset : 0) + planningOffset) || 0);
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
            }, [compactHeaderOffset, compactStickyVisible, epicGroups, planningOffset]);

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
                return visibleTaskJiraEpicKeys;
            }, [selectedView, showScenario, epmJiraEpicKeys, scenarioJiraEpicKeys, visibleTaskJiraEpicKeys]);
            const activeJiraExportStoryKeys = React.useMemo(() => {
                if (selectedView === 'epm') return epmJiraStoryKeys;
                if (showScenario) return scenarioJiraStoryKeys;
                return visibleTaskJiraStoryKeys;
            }, [selectedView, showScenario, epmJiraStoryKeys, scenarioJiraStoryKeys, visibleTaskJiraStoryKeys]);
            const epmDependencyTasks = React.useMemo(() => {
                const boards = epmRollupExportBoards;
                return flattenEpmRollupBoardsForDependencies(boards);
            }, [epmRollupExportBoards]);

            const dependencyTasks = React.useMemo(
                () => selectedView === 'epm' ? epmDependencyTasks : [...loadedProductTasks, ...loadedTechTasks],
                [selectedView, epmDependencyTasks, loadedProductTasks, loadedTechTasks]
            );
            const dependencyKeySignature = React.useMemo(() => {
                const keys = Array.from(new Set(dependencyTasks.map(task => task.key).filter(Boolean)));
                return keys.sort().join('|');
            }, [dependencyTasks]);

            useEffect(() => {
                if (!showDependencies && !showBlockedAlert) {
                    setDependencyData({});
                    return;
                }
                if (selectedView === 'eng') {
                    if (selectedSprint !== null && lastLoadedSprintRef.current !== selectedSprint) return;
                    if (!tasksFetched || productTasksLoading || techTasksLoading) return;
                }
                if (selectedView === 'epm' && epmRollupLoading) {
                    return;
                }
                if (!dependencyKeySignature) {
                    setDependencyData({});
                    return;
                }
                const keys = dependencyKeySignature.split('|').filter(Boolean);
                fetchDependencies(keys);
            }, [selectedView, showDependencies, showBlockedAlert, dependencyKeySignature, selectedSprint, tasksFetched, productTasksLoading, techTasksLoading, epmRollupLoading]);

            useEffect(() => {
                if (!showDependencies) {
                    setDependencyFocus(null);
                }
            }, [showDependencies]);

            const issueByKey = React.useMemo(() => {
                const map = new Map();
                dependencyTasks.forEach(task => {
                    if (task.key) {
                        map.set(task.key, task);
                    }
                });
                return map;
            }, [dependencyTasks]);

            const activeDependencyFocus = dependencyFocus || dependencyHover;
            const focusRelatedSet = React.useMemo(() => {
                return new Set(activeDependencyFocus?.relatedKeys || []);
            }, [activeDependencyFocus]);

            const summaryStats = React.useMemo(() => {
                const counts = {
                    highPriority: 0,
                    minorPriority: 0,
                    done: 0,
                    inProgress: 0,
                    todoAccepted: 0
                };
                const points = {
                    total: 0,
                    done: 0,
                    highPriority: 0,
                    minorPriority: 0,
                    inProgress: 0,
                    todoAccepted: 0
                };
                baseFilteredTasks.forEach(task => {
                    const priority = task.fields.priority?.name;
                    const status = task.fields.status?.name;
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    const storyPoints = Number.isNaN(sp) ? 0 : sp;
                    points.total += storyPoints;

                    const isHigh = priority === 'Blocker' || priority === 'Highest' ||
                        priority === 'Critical' || priority === 'High';
                    const isMinor = priority === 'Minor' || priority === 'Low' ||
                        priority === 'Trivial' || priority === 'Lowest';
                    if (isHigh) {
                        counts.highPriority += 1;
                        points.highPriority += storyPoints;
                    }
                    if (isMinor) {
                        counts.minorPriority += 1;
                        points.minorPriority += storyPoints;
                    }
                    if (status === 'Done') {
                        counts.done += 1;
                        points.done += storyPoints;
                    }
                    if (status === 'In Progress') {
                        counts.inProgress += 1;
                        points.inProgress += storyPoints;
                    }
                    if (status === 'To Do' || status === 'Pending' || status === 'Accepted') {
                        counts.todoAccepted += 1;
                        points.todoAccepted += storyPoints;
                    }
                });
                return { counts, points };
            }, [baseFilteredTasks]);

            const highPriorityCount = summaryStats.counts.highPriority;
            const minorPriorityCount = summaryStats.counts.minorPriority;
            const doneTasksCount = summaryStats.counts.done;
            const inProgressTasksCount = summaryStats.counts.inProgress;
            const todoAcceptedTasksCount = summaryStats.counts.todoAccepted;
            const totalStoryPoints = summaryStats.points.total;
            const doneStoryPoints = summaryStats.points.done;
            const highPriorityStoryPoints = summaryStats.points.highPriority;
            const minorPriorityStoryPoints = summaryStats.points.minorPriority;
            const inProgressStoryPoints = summaryStats.points.inProgress;
            const todoAcceptedStoryPoints = summaryStats.points.todoAccepted;
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

            const handleAlertStoryClick = (taskKey) => {
                if (!scrollToTaskItem(taskKey) && jiraUrl) {
                    window.open(`${jiraUrl}/browse/${taskKey}`, '_blank', 'noopener,noreferrer');
                }
            };

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

            const getDependencyKeys = React.useCallback((taskKey, action) => {
                if (!taskKey) return [];
                const entries = (dependencyData[taskKey] || [])
                    .filter(dep => dep.key && dep.category === 'dependency');
                const direction = action === 'dependents' ? 'inward' : 'outward';
                const seen = new Set();
                return entries
                    .filter(dep => dep.direction === direction)
                    .filter(dep => {
                        const key = `${dep.key}-${dep.direction}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    })
                    .map(dep => dep.key)
                    .filter(Boolean);
            }, [dependencyData]);

            const getBlockLinkBuckets = (entries, taskKey) => {
                const blockedBy = [];
                const blocks = [];
                (entries || []).forEach(dep => {
                    if (!dep?.key || !taskKey) return;
                    const otherKey = dep.key !== taskKey
                        ? dep.key
                        : (dep.prereqKey === taskKey ? dep.dependentKey : dep.prereqKey);
                    if (!otherKey) return;
                    if (dep.dependentKey === taskKey) {
                        blockedBy.push(otherKey);
                        return;
                    }
                    if (dep.prereqKey === taskKey) {
                        blocks.push(otherKey);
                        return;
                    }
                    if (dep.direction === 'inward') {
                        blockedBy.push(otherKey);
                        return;
                    }
                    if (dep.direction === 'outward') {
                        blocks.push(otherKey);
                    }
                });
                return {
                    blockedBy: Array.from(new Set(blockedBy)),
                    blocks: Array.from(new Set(blocks))
                };
            };

            const getBlockKeys = React.useCallback((taskKey, action) => {
                if (!taskKey) return [];
                const entries = (dependencyData[taskKey] || [])
                    .filter(dep => dep.key && dep.category === 'block');
                const { blockedBy, blocks } = getBlockLinkBuckets(entries, taskKey);
                return action === 'blocks' ? blocks : blockedBy;
            }, [dependencyData]);

            const getFocusKeys = React.useCallback((taskKey, action) => {
                if (action === 'blocked-by' || action === 'blocks') {
                    return getBlockKeys(taskKey, action);
                }
                return getDependencyKeys(taskKey, action);
            }, [getBlockKeys, getDependencyKeys]);

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
                    const dependencyKeys = getFocusKeys(taskKey, action);
                    const relatedKeys = Array.from(new Set([taskKey, ...dependencyKeys]));
                    const missingKeys = dependencyKeys.filter(key => !issueByKey.has(key));
                    setDependencyFocus({
                        taskKey,
                        action,
                        relatedKeys,
                        dependencyKeys,
                        missingKeys
                    });
                    return;
                }
                if (dependencyFocus && !event.target.closest('.task-item')) {
                    setDependencyFocus(null);
                }
            };

            const handleDependencyHoverEnter = (taskKey, action) => {
                if (!taskKey || !action) return;
                if (dependencyFocus) return;
                const dependencyKeys = getFocusKeys(taskKey, action);
                const relatedKeys = Array.from(new Set([taskKey, ...dependencyKeys]));
                setDependencyHover({
                    taskKey,
                    action,
                    relatedKeys,
                    dependencyKeys
                });
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
                const controller = registerSprintFetch();
                const fetchLookup = async () => {
                    setDependencyLookupLoading(true);
                    try {
                        const response = await fetch(
                            `${BACKEND_URL}/api/issues/lookup?keys=${encodeURIComponent(missingKeys.join(','))}`,
                            { signal: controller.signal }
                        );
                        if (!response.ok) {
                            console.error('Dependency lookup failed:', response.status);
                            return;
                        }
                        const data = await response.json();
                        if (isCancelled) return;
                        const issues = data.issues || [];
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
                        if (!isCancelled) {
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

            const toggleTaskSelection = (taskKey) => {
                setSelectedTasks(prev => {
                    const newSelected = { ...prev };
                    if (newSelected[taskKey]) {
                        delete newSelected[taskKey];
                    } else {
                        newSelected[taskKey] = true;
                    }
                    return newSelected;
                });
            };

            const clearSelectedTasks = () => {
                setSelectedTasks({});
            };

            const selectAllVisiblePlanningTasks = () => {
                setSelectedTasks(() => {
                    const next = {};
                    visibleTasksForList.forEach(task => {
                        if (task?.key) {
                            next[task.key] = true;
                        }
                    });
                    return next;
                });
            };

            const selectPlanningTasksByStatus = (statuses) => {
                const allowed = new Set((statuses || []).map(normalizeStatus));
                setSelectedTasks(() => {
                    const next = {};
                    selectionTasks.forEach(task => {
                        const status = normalizeStatus(task.fields.status?.name);
                        if (allowed.has(status)) {
                            next[task.key] = true;
                        }
                    });
                    return next;
                });
            };

            const includePlanningTasksByStatus = (statuses) => {
                const allowed = new Set((statuses || []).map(normalizeStatus));
                setSelectedTasks(prev => {
                    const next = { ...prev };
                    selectionTasks.forEach(task => {
                        const status = normalizeStatus(task.fields.status?.name);
                        if (allowed.has(status)) {
                            next[task.key] = true;
                        }
                    });
                    return next;
                });
            };

            const toggleIncludeByStatus = (statuses) => {
                const allowed = new Set((statuses || []).map(normalizeStatus));
                setSelectedTasks(prev => {
                    const next = { ...prev };
                    const matching = selectionTasks.filter(task =>
                        allowed.has(normalizeStatus(task.fields.status?.name))
                    );
                    const allSelected = matching.length > 0 && matching.every(task => prev[task.key]);
                    matching.forEach(task => {
                        if (allSelected) {
                            delete next[task.key];
                        } else {
                            next[task.key] = true;
                        }
                    });
                    return next;
                });
            };

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
                return selectedTasksList.filter(task => {
                    const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
                    return !excludedEpicSet.has(epicKey);
                });
            }, [showPlanning, selectedTasksList, excludedEpicSet]);
            const selectedSP = React.useMemo(() => {
                if (!showPlanning) return 0;
                return selectedTasksList.reduce((sum, task) => {
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    return sum + (Number.isNaN(sp) ? 0 : sp);
                }, 0);
            }, [showPlanning, selectedTasksList]);
            const selectedCount = showPlanning ? selectedTasksList.length : 0;

            const getCapacityStatus = (selected, capacity) => {
                if (!capacity) {
                    return { label: '', text: '', status: '', title: '' };
                }
                const ratio = capacity > 0 ? selected / capacity : 0;
                const overPercent = Math.max(0, (ratio - 1) * 100);
                const underPercent = Math.max(0, (1 - ratio) * 100);
                const status = ratio > 1.2 ? 'over' : ratio < 0.9 ? 'under' : '';
                const suffix = ratio >= 1
                    ? `${overPercent.toFixed(0)}% over`
                    : `${underPercent.toFixed(0)}% under`;
                const shortLabel = ratio >= 1
                    ? `${overPercent.toFixed(0)}% over`
                    : `${underPercent.toFixed(0)}% under`;
                const minToRemove = ratio > 1.2 ? (ratio - 1.2) * capacity : 0;
                const minToAdd = ratio < 0.9 ? (0.9 - ratio) * capacity : 0;
                const title = ratio > 1.2
                    ? `Please remove at least ${minToRemove.toFixed(1)} SP to reach 120%.`
                    : ratio < 0.9
                        ? `Please add at least ${minToAdd.toFixed(1)} SP to reach 90%.`
                        : '';
                return {
                    label: shortLabel,
                    text: `${selected.toFixed(1)} selected | ${capacity.toFixed(1)} capacity | ${suffix}`,
                    status,
                    title
                };
            };

            const getTeamCapacityMeta = (selected, capacity) => {
                if (!capacity) return { text: '', status: '', title: '' };
                const delta = selected - capacity;
                if (delta <= 0) {
                    return {
                        text: `${Math.abs(delta).toFixed(1)} SP left`,
                        status: '',
                        title: ''
                    };
                }
                const pct = capacity > 0 ? (delta / capacity) * 100 : 0;
                const status = pct >= 20 ? 'over' : '';
                return {
                    text: `↑ ${delta.toFixed(1)} SP · ${pct.toFixed(0)}%`,
                    status,
                    title: 'Please remove some story points or add capacity.'
                };
            };


            const selectedTeamStats = React.useMemo(() => {
                if (!showPlanning) return {};
                return selectedTasksList.reduce((acc, task) => {
                    const teamInfo = getTeamInfo(task);
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    if (!acc[teamInfo.id]) {
                        acc[teamInfo.id] = { name: teamInfo.name, storyPoints: 0 };
                    }
                    acc[teamInfo.id].storyPoints += Number.isNaN(sp) ? 0 : sp;
                    return acc;
                }, {});
            }, [showPlanning, selectedTasksList]);

            const selectedProjectStats = React.useMemo(() => {
                if (!showPlanning) return {};
                return selectedPlanningTasksList.reduce((acc, task) => {
                    const pk = task.fields?.projectKey || task.key.split('-')[0];
                    const bucket = techProjectKeys.has(pk) ? 'TECH' : 'PRODUCT';
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    if (!acc[bucket]) {
                        acc[bucket] = 0;
                    }
                    acc[bucket] += Number.isNaN(sp) ? 0 : sp;
                    return acc;
                }, {});
            }, [showPlanning, selectedPlanningTasksList, techProjectKeys]);

            const selectedTeamProjectStats = React.useMemo(() => {
                if (!showPlanning) return {};
                return selectedPlanningTasksList.reduce((acc, task) => {
                    const teamInfo = getTeamInfo(task);
                    const pk = task.fields?.projectKey || task.key.split('-')[0];
                    const bucket = techProjectKeys.has(pk) ? 'tech' : 'product';
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    if (!acc[teamInfo.id]) {
                        acc[teamInfo.id] = { product: 0, tech: 0 };
                    }
                    acc[teamInfo.id][bucket] += Number.isNaN(sp) ? 0 : sp;
                    return acc;
                }, {});
            }, [showPlanning, selectedPlanningTasksList, techProjectKeys]);

            const excludedProjectStats = React.useMemo(() => {
                if (!showPlanning) return {};
                return selectedTasksList.reduce((acc, task) => {
                    const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
                    if (!excludedEpicSet.has(epicKey)) return acc;
                    const pk = task.fields?.projectKey || task.key.split('-')[0];
                    const projectKey = techProjectKeys.has(pk) ? 'TECH' : 'PRODUCT';
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    if (!acc[projectKey]) {
                        acc[projectKey] = 0;
                    }
                    acc[projectKey] += Number.isNaN(sp) ? 0 : sp;
                    return acc;
                }, {});
            }, [showPlanning, selectedTasksList, excludedEpicSet, techProjectKeys]);

            const capacitySplit = React.useMemo(() => ({ product: 0.7, tech: 0.3 }), []);
            const capacityMultiplier = showProduct && showTech
                ? 1
                : showProduct
                    ? capacitySplit.product
                    : showTech
                        ? capacitySplit.tech
                        : 1;

            const teamCapacityStats = React.useMemo(() => {
                if (!showPlanning || !capacityEnabled) return {};
                return capacityTasks.reduce((acc, task) => {
                    const status = normalizeStatus(task.fields.status?.name);
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    if (!sp) {
                        return acc;
                    }

                    const teamInfo = getTeamInfo(task);
                    if (!acc[teamInfo.id]) {
                        acc[teamInfo.id] = {
                            name: teamInfo.name,
                            product: { todoPending: 0, accepted: 0, postponed: 0 },
                            tech: { todoPending: 0, accepted: 0, postponed: 0 }
                        };
                    }

                    const pk = task.fields?.projectKey || task.key.split('-')[0];
                    const bucket = techProjectKeys.has(pk) ? 'tech' : 'product';
                    if (status === 'to do' || status === 'pending') {
                        acc[teamInfo.id][bucket].todoPending += sp;
                    }
                    if (status === 'accepted') {
                        acc[teamInfo.id][bucket].accepted += sp;
                    }
                    if (status === 'postponed') {
                        acc[teamInfo.id][bucket].postponed += sp;
                    }

                    return acc;
                }, {});
            }, [showPlanning, capacityEnabled, capacityTasks, techProjectKeys]);

            const teamCapacityEntries = React.useMemo(() => {
                return Object.entries(teamCapacityStats)
                    .map(([id, info]) => ({
                        id,
                        name: info.name,
                        product: info.product,
                        tech: info.tech,
                        total: {
                            todoPending: info.product.todoPending + info.tech.todoPending,
                            accepted: info.product.accepted + info.tech.accepted,
                            postponed: info.product.postponed + info.tech.postponed
                        }
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));
            }, [teamCapacityStats]);

            const displayedTeamCapacityEntries = React.useMemo(() => {
                return !isAllTeamsSelected
                    ? teamCapacityEntries.filter(entry => selectedTeamSet.has(entry.id))
                    : teamCapacityEntries;
            }, [teamCapacityEntries, isAllTeamsSelected, selectedTeamSet]);

            const teamSpTotals = React.useMemo(() => {
                const totals = {};
                for (const task of capacityTasks) {
                    const sp = parseFloat(task.fields?.customfield_10004 || 0);
                    if (!sp) continue;
                    const tid = getTeamInfo(task).id;
                    totals[tid] = (totals[tid] || 0) + sp;
                }
                return totals;
            }, [capacityTasks]);

            const displayedTeamOptions = React.useMemo(() => {
                const base = !isAllTeamsSelected
                    ? teamOptions.filter(team => team.id !== 'all' && selectedTeamSet.has(team.id))
                    : teamOptions.filter(team => team.id !== 'all');
                return base.filter(team => (teamSpTotals[team.id] || 0) > 0);
            }, [teamOptions, isAllTeamsSelected, selectedTeamSet, teamSpTotals]);

            const capacityTeamNames = React.useMemo(() => {
                if (!showPlanning || !capacityEnabled) return [];
                return displayedTeamOptions
                    .map(team => toCapacityShortName(team.name))
                    .filter(Boolean);
            }, [showPlanning, capacityEnabled, displayedTeamOptions]);

            useEffect(() => {
                if (!capacityEnabled) return;
                if (!showPlanning) return;
                if (!selectedSprintInfo?.name) return;
                fetchCapacity(selectedSprintInfo.name);
            }, [capacityEnabled, showPlanning, selectedSprintInfo?.name, capacityTeamNames.join('|')]);

            const capacityTeamIds = React.useMemo(() => {
                return !isAllTeamsSelected
                    ? Array.from(selectedTeamSet)
                    : teamCapacityEntries.map(entry => entry.id);
            }, [isAllTeamsSelected, selectedTeamSet, teamCapacityEntries]);

            const getTeamCapacity = (teamName) => {
                if (!capacityEnabled) return 0;
                const key = normalizeCapacityKey(teamName);
                if (!key) return 0;
                if (capacityByTeam[key]) return capacityByTeam[key];
                const entry = Object.entries(capacityByTeam).find(([capacityKey]) =>
                    capacityKey.includes(key) || key.includes(capacityKey)
                );
                return entry ? entry[1] : 0;
            };

            const excludedCapacityByTeamId = React.useMemo(() => {
                if (!capacityEnabled || !showPlanning) return {};
                return capacityTasks.reduce((acc, task) => {
                    const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
                    if (!excludedEpicSet.has(epicKey)) return acc;
                    const teamInfo = getTeamInfo(task);
                    const sp = parseFloat(task.fields.customfield_10004 || 0);
                    if (Number.isNaN(sp)) return acc;
                    acc[teamInfo.id] = (acc[teamInfo.id] || 0) + sp;
                    return acc;
                }, {});
            }, [capacityEnabled, showPlanning, capacityTasks, excludedEpicSet]);

            const getTeamNetCapacity = (team) => {
                if (!capacityEnabled) return 0;
                const base = getTeamCapacity(team.name);
                const excluded = excludedCapacityByTeamId[team.id] || 0;
                return Math.max(0, base - excluded);
            };

            const capacityTotalsSummary = React.useMemo(() => {
                const totalCapacityBase = capacityEnabled
                    ? displayedTeamOptions.reduce((sum, team) => sum + getTeamCapacity(team.name), 0)
                    : 0;
                const excludedCapacityTotal = capacityEnabled
                    ? displayedTeamOptions.reduce((sum, team) => sum + (excludedCapacityByTeamId[team.id] || 0), 0)
                    : 0;
                const estimatedCapacityRaw = Math.max(0, totalCapacityBase - excludedCapacityTotal);
                return {
                    totalCapacityBase,
                    excludedCapacityTotal,
                    estimatedCapacityRaw,
                    totalCapacityAdjusted: totalCapacityBase * capacityMultiplier,
                    estimatedCapacityAdjusted: estimatedCapacityRaw * capacityMultiplier,
                    excludedCapacityAdjusted: excludedCapacityTotal * capacityMultiplier
                };
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
                    const hasTech = (epic.tasks || []).some(task => techProjectKeys.has(task.fields?.projectKey || String(task.key || '').split('-')[0]));
                    const hasProduct = (epic.tasks || []).some(task => !techProjectKeys.has(task.fields?.projectKey || String(task.key || '').split('-')[0]));
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
                if (!showPlanning || !capacityEnabled) {
                    return { PRODUCT: 0, TECH: 0 };
                }
                const totals = displayedTeamOptions.reduce((acc, team) => {
                    const teamPlanningCapacity = getTeamNetCapacity(team);
                    if (!teamPlanningCapacity) return acc;
                    const stats = selectedTeamProjectStats[team.id] || { product: 0, tech: 0 };
                    const totalSelected = stats.product + stats.tech;
                    const techHeavy = totalSelected > 0 ? stats.tech >= stats.product : false;
                    const split = techHeavy ? { product: 0.2, tech: 0.8 } : capacitySplit;
                    acc.PRODUCT += teamPlanningCapacity * split.product;
                    acc.TECH += teamPlanningCapacity * split.tech;
                    return acc;
                }, {
                    PRODUCT: 0,
                    TECH: 0
                });
                if (!showProduct) totals.PRODUCT = 0;
                if (!showTech) totals.TECH = 0;
                return totals;
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
                if (!showPlanning) return [];
                return Object.entries(selectedProjectStats)
                    .map(([id, storyPoints]) => ({
                        id,
                        name: id,
                        storyPoints,
                        capacity: capacityEnabled ? (projectCapacity[id] || 0) : null
                    }))
                    .sort((a, b) => {
                        const order = (key) => {
                            if (key === 'PRODUCT') return 0;
                            if (key === 'TECH') return 1;
                            return 99;
                        };
                        const diff = order(a.id) - order(b.id);
                        if (diff !== 0) return diff;
                        return a.name.localeCompare(b.name);
                    });
            }, [showPlanning, selectedProjectStats, capacityEnabled, projectCapacity]);

            const selectedTeamEntries = React.useMemo(() => {
                if (!showPlanning) return [];
                return displayedTeamOptions.map((team) => ({
                    id: team.id,
                    name: team.name,
                    storyPoints: selectedTeamStats[team.id]?.storyPoints || 0,
                    teamCapacity: capacityEnabled ? getTeamCapacity(team.name) * capacityMultiplier : null,
                    planningCapacity: capacityEnabled ? getTeamNetCapacity(team) * capacityMultiplier : null
                }));
            }, [
                showPlanning,
                displayedTeamOptions,
                selectedTeamStats,
                capacityEnabled,
                capacityMultiplier,
                capacityByTeam,
                excludedCapacityByTeamId
            ]);

            const capacityTotals = React.useMemo(() => {
                if (!showPlanning || !capacityEnabled) {
                    return {
                        product: { todoPending: 0, accepted: 0, postponed: 0 },
                        tech: { todoPending: 0, accepted: 0, postponed: 0 },
                        total: { todoPending: 0, accepted: 0, postponed: 0 }
                    };
                }
                return displayedTeamCapacityEntries.reduce((acc, info) => {
                    acc.product.todoPending += info.product.todoPending;
                    acc.product.accepted += info.product.accepted;
                    acc.product.postponed += info.product.postponed;
                    acc.tech.todoPending += info.tech.todoPending;
                    acc.tech.accepted += info.tech.accepted;
                    acc.tech.postponed += info.tech.postponed;
                    acc.total.todoPending += info.total.todoPending;
                    acc.total.accepted += info.total.accepted;
                    acc.total.postponed += info.total.postponed;
                    return acc;
                }, {
                    product: { todoPending: 0, accepted: 0, postponed: 0 },
                    tech: { todoPending: 0, accepted: 0, postponed: 0 },
                    total: { todoPending: 0, accepted: 0, postponed: 0 }
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

            const buildTeamStatusLink = ({ teamId, teamIds, projectName, projectNames, statuses, excludeStatuses, priorityName, issueType }) => {
                const ids = teamIds || (teamId ? [teamId] : []);
                if (!jiraUrl || !ids.length) return '';
                const clauses = [];
                const projects = projectNames || (projectName ? [projectName] : []);
                if (projects.length === 1) {
                    clauses.push(`project = "${projects[0]}"`);
                } else if (projects.length > 1) {
                    const quoted = projects.map(p => `"${p}"`).join(', ');
                    clauses.push(`project in (${quoted})`);
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

            const buildPostponedLink = ({ teamId, teamIds, projectName, projectNames }) => {
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['Postponed'], issueType: 'Story' });
            };

            const buildTodoPendingLink = ({ teamId, teamIds, projectName, projectNames }) => {
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['To Do', 'Pending'], issueType: 'Story' });
            };

            const buildAcceptedLink = ({ teamId, teamIds, projectName, projectNames }) => {
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['Accepted'], issueType: 'Story' });
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
                    .map(([teamId, label]) => [String(teamId || '').trim(), String(label || '').trim()])
                    .filter(([teamId, label]) => teamId && label);
                return Object.fromEntries(entries);
            }, [activeGroupTeamLabels]);
            const getFuturePlanningTeamInfo = React.useCallback((epic) => {
                const fallbackSelectedTeamName = selectedTeamSet.size === 1
                    ? (teamNameById.get(Array.from(selectedTeamSet)[0]) || '')
                    : '';
                return getFuturePlanningEpicTeamInfo(epic, {
                    selectedTeamSet,
                    teamLabels: normalizedActiveGroupTeamLabels,
                    resolveTeamName,
                    fallbackSelectedTeamName,
                    teamNameById
                });
            }, [selectedTeamSet, normalizedActiveGroupTeamLabels, resolveTeamName, teamNameById]);
            const getFuturePlanningTeamLabel = React.useCallback((epic) => {
                return getFuturePlanningExpectedTeamLabel(epic, {
                    selectedTeamSet,
                    teamLabels: normalizedActiveGroupTeamLabels
                });
            }, [selectedTeamSet, normalizedActiveGroupTeamLabels]);
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
            const epicHasLabel = React.useCallback((epic, label) => {
                const target = String(label || '').trim().toLowerCase();
                if (!target) return false;
                return (epic?.labels || []).some((item) => String(item || '').trim().toLowerCase() === target);
            }, []);
            const epicMatchesPlanningSprintValue = React.useCallback((epic) => {
                return epicMatchesSelectedSprint(epic, {
                    selectedSprint,
                    selectedSprintName: selectedSprintInfo?.name || ''
                });
            }, [selectedSprint, selectedSprintInfo?.name]);
            const planningCandidateEpics = React.useMemo(() => {
                return epicsInScope.filter((epic) => {
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
            }, [epicsInScope, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet, normalizedActiveGroupTeamLabels]);
            const backlogEpics = React.useMemo(() => {
                if (!isFutureSprintSelected) return [];
                const seen = new Set();
                const remoteBacklog = filterExplicitBacklogEpics([...backlogProductEpics, ...backlogTechEpics]);
                const sprintValueBacklog = filterExplicitBacklogEpics(planningCandidateEpics);
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
            }, [isFutureSprintSelected, backlogProductEpics, backlogTechEpics, planningCandidateEpics, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet, normalizedActiveGroupTeamLabels]);
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
                    const teamLabel = getFuturePlanningTeamLabel(epic);
                    return !teamLabel || !epicHasLabel(epic, teamLabel);
                });
            }, [isFutureSprintSelected, planningCandidateEpics, backlogEpicKeySet, missingTeamEpicKeySet, getFuturePlanningTeamLabel, epicMatchesPlanningSprintValue, epicHasLabel]);
            const missingLabelEpicKeySet = React.useMemo(
                () => new Set(missingLabelEpics.map(epic => epic.key).filter(Boolean)),
                [missingLabelEpics]
            );
            const needsStoriesEntries = React.useMemo(() => {
                if (!isFutureSprintSelected) return [];
                return planningCandidateEpics.reduce((entries, epic) => {
                    if (backlogEpicKeySet.has(epic.key) || missingTeamEpicKeySet.has(epic.key) || missingLabelEpicKeySet.has(epic.key)) {
                        return entries;
                    }
                    const teamLabel = getFuturePlanningTeamLabel(epic);
                    if (!teamLabel || !epicMatchesPlanningSprintValue(epic) || !epicHasLabel(epic, teamLabel)) {
                        return entries;
                    }
                    const entry = classifyFuturePlanningNeedsStories({
                        epic,
                        epicStories: storiesByEpicKey.get(epic.key) || [],
                        normalizeStatus: (value) => normalizeStatus(value),
                        isTaskInSelectedSprint
                    });
                    if (entry) {
                        entries.push(entry);
                    }
                    return entries;
                }, []);
            }, [isFutureSprintSelected, planningCandidateEpics, backlogEpicKeySet, missingTeamEpicKeySet, missingLabelEpicKeySet, getFuturePlanningTeamLabel, epicMatchesPlanningSprintValue, epicHasLabel, storiesByEpicKey, isTaskInSelectedSprint]);
            const needsStoriesEpics = React.useMemo(
                () => needsStoriesEntries.map((entry) => entry.epic),
                [needsStoriesEntries]
            );

            const emptyEpics = epicsInScope
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
                    const allEpicStories = readyToCloseTasks.filter(task => {
                        if (!task.fields?.epicKey) return false;
                        if (task.fields.epicKey !== epic.key) return false;
                        if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                        return true;
                    });
                    const storiesToCheck = allEpicStories.length > 0 ? allEpicStories : epicStories;
                    return storiesToCheck.every(task => readyToCloseStoryStatuses.has(normalizeStatus(task.fields.status?.name)));
                })
                .filter(epic => !dismissedAlertSet.has(epic.key));

            const analysisEpicsSource = React.useMemo(() => {
                const seen = new Set();
                const merged = [...readyToCloseEpicsInScope, ...epicsInScope].filter(epic => {
                    if (!epic?.key) return false;
                    if (seen.has(epic.key)) return false;
                    seen.add(epic.key);
                    return true;
                });
                return merged;
            }, [readyToCloseEpicsInScope, epicsInScope]);

            const sortByPriorityThenSummary = (a, b) => {
                const priorityA = priorityOrder[a.fields.priority?.name] || 999;
                const priorityB = priorityOrder[b.fields.priority?.name] || 999;
                if (priorityA !== priorityB) return priorityA - priorityB;
                return (a.fields.summary || '').localeCompare(b.fields.summary || '');
            };

            const groupAlertsByTeam = (items, resolveTeam, sortItems) => {
                const groups = new Map();
                (items || []).forEach(item => {
                    const team = resolveTeam(item) || { id: 'unknown', name: 'Unknown Team' };
                    const id = team.id || team.name || 'unknown';
                    const name = team.name || 'Unknown Team';
                    const entry = groups.get(id) || { id, name, items: [] };
                    entry.items.push(item);
                    groups.set(id, entry);
                });
                const list = Array.from(groups.values());
                list.forEach(group => {
                    if (sortItems) {
                        group.items.sort(sortItems);
                    }
                });
                return list.sort((a, b) => a.name.localeCompare(b.name));
            };

            const missingAlertTeams = groupAlertsByTeam(consolidatedMissingStories, (item) => getTeamInfo(item.task));
            const blockedAlertTeams = groupAlertsByTeam(blockedTasks, (task) => getTeamInfo(task), sortByPriorityThenSummary);
            const doneEpicTeams = groupAlertsByTeam(doneStoryEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
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
                    if (!epicMatchesSelectedSprint(epic, selectedSprintEpicStories)) return false;
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

            const postponedAlertTeams = groupAlertsByTeam(postponedTasks, (task) => getTeamInfo(task), sortByPriorityThenSummary);
            const postponedEpicTeams = groupAlertsByTeam(futureRoutedEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
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
                    if (Number(epic.selectedActionableStories || 0) > 0) return false;
                    if (epicsWithActionableStoriesInSelectedSprint.has(epic.key)) return false;
                    if (futureRoutedEpicKeys.has(epic.key)) return false;
                    return true;
                });
            }, [isFutureSprintSelected, emptyEpics, epicsWithActionableStoriesInSelectedSprint, futureRoutedEpics]);
            const emptyEpicTeams = groupAlertsByTeam(emptyEpicsForAlert, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));

            const waitingForStoriesEpics = React.useMemo(() => {
                if (isFutureSprintSelected) {
                    return [];
                }
                const seen = new Set();
                const merged = [...analysisWaitingEpics, ...postponedEmptyEpics].filter(epic => {
                    if (!epic?.key) return false;
                    if (seen.has(epic.key)) return false;
                    seen.add(epic.key);
                    return true;
                });
                return merged;
            }, [isFutureSprintSelected, analysisWaitingEpics, postponedEmptyEpics]);

            const analysisEpicTeams = groupAlertsByTeam(waitingForStoriesEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const backlogEpicTeams = groupAlertsByTeam(backlogEpics, (epic) => isFutureSprintSelected ? getFuturePlanningTeamInfo(epic) : getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const missingTeamEpicTeams = groupAlertsByTeam(missingTeamEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const missingLabelEpicTeams = groupAlertsByTeam(missingLabelEpics, (epic) => isFutureSprintSelected ? getFuturePlanningTeamInfo(epic) : getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
            const needsStoriesTeams = groupAlertsByTeam(needsStoriesEntries, (entry) => getFuturePlanningTeamInfo(entry.epic), (a, b) => (a.epic.summary || '').localeCompare(b.epic.summary || ''));

            const missingAlertKeySet = React.useMemo(
                () => new Set(consolidatedMissingStories.map(item => item.task?.key).filter(Boolean)),
                [consolidatedMissingStories]
            );
            const blockedAlertKeySet = React.useMemo(
                () => new Set(blockedTasks.map(task => task.key).filter(Boolean)),
                [blockedTasks]
            );
            const postponedAlertKeySet = React.useMemo(
                () => new Set([...postponedTasks.map(task => task.key), ...futureRoutedEpics.map(epic => epic.key)].filter(Boolean)),
                [postponedTasks, futureRoutedEpics]
            );
            const backlogAlertKeySet = React.useMemo(
                () => new Set(backlogEpics.map(epic => epic.key).filter(Boolean)),
                [backlogEpics]
            );
            const needsStoriesAlertKeySet = React.useMemo(
                () => new Set(needsStoriesEpics.map(epic => epic.key).filter(Boolean)),
                [needsStoriesEpics]
            );
            const waitingAlertKeySet = React.useMemo(
                () => new Set(waitingForStoriesEpics.map(epic => epic.key).filter(Boolean)),
                [waitingForStoriesEpics]
            );
            const emptyAlertKeySet = React.useMemo(
                () => new Set(emptyEpicsForAlert.map(epic => epic.key).filter(Boolean)),
                [emptyEpicsForAlert]
            );
            const doneAlertKeySet = React.useMemo(
                () => new Set(doneStoryEpics.map(epic => epic.key).filter(Boolean)),
                [doneStoryEpics]
            );

            const alertCounts = {
                missing: consolidatedMissingStories.length,
                blocked: blockedTasks.length,
                followup: postponedTasks.length + futureRoutedEpics.length,
                backlog: backlogEpics.length,
                missingTeam: missingTeamEpics.length,
                missingLabels: missingLabelEpics.length,
                needsStories: needsStoriesEpics.length,
                waiting: waitingForStoriesEpics.length,
                empty: emptyEpicsForAlert.length,
                done: doneStoryEpics.length
            };
            const alertItemCount = alertCounts.missing + alertCounts.blocked + alertCounts.followup + alertCounts.backlog + alertCounts.missingTeam + alertCounts.missingLabels + alertCounts.needsStories + alertCounts.waiting + alertCounts.empty + alertCounts.done;

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
                setShowGroupDropdown(false);
                setShowEpmProjectDropdown(false);
                setShowEpmSubGoalFilterDropdown(false);
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
            }, [showPlanning, selectedCount, selectedSP, teamCapacityEntries.length, capacityEnabled, totalCapacityAdjusted, selectedTeamEntries.length]);

            // Detect when planning panel is sticky (stuck to viewport top)
            useEffect(() => {
                if (!showPlanning) { setIsPlanningStuck(false); return; }
                const node = planningPanelRef.current;
                if (!node) return;
                const check = () => {
                    const rect = node.getBoundingClientRect();
                    const stickyTop = compactStickyVisible ? compactHeaderOffset : 0;
                    setIsPlanningStuck(rect.top <= stickyTop);
                };
                check();
                window.addEventListener('scroll', check, { passive: true });
                return () => window.removeEventListener('scroll', check);
            }, [compactHeaderOffset, compactStickyVisible, showPlanning]);

            const openSelectedInJira = () => {
                const keys = capacityTasks
                    .filter(task => selectedTasks[task.key])
                    .map(task => task.key);
                openJiraIssueSearch({ jiraUrl, keys });
            };

            const activeControlSurface = compactStickyVisible ? 'compact' : 'main';
            const compactStickyTop = compactStickyVisible ? compactHeaderOffset : 0;
            const epicStickyTop = compactStickyTop + planningOffset;
            const containerStyle = {
                '--compact-header-offset': `${compactStickyTop}px`,
                '--planning-offset': `${planningOffset}px`,
                '--planning-sticky-top': `${compactStickyTop}px`,
                '--epic-sticky-top': `${epicStickyTop}px`,
                '--scenario-sticky-top': `${epicStickyTop}px`
            };
            const showGroupControl = (groupsConfig.groups || []).length > 1;
            const searchActive = searchFocused || Boolean(String(searchInput || '').trim());
            const handleSearchFocus = () => {
                if (searchFocusReleaseTimeoutRef.current) {
                    window.clearTimeout(searchFocusReleaseTimeoutRef.current);
                    searchFocusReleaseTimeoutRef.current = null;
                }
                setSearchFocused(true);
            };
            const handleSearchBlur = () => {
                if (searchFocusReleaseTimeoutRef.current) {
                    window.clearTimeout(searchFocusReleaseTimeoutRef.current);
                }
                searchFocusReleaseTimeoutRef.current = window.setTimeout(() => {
                    setSearchFocused(false);
                    searchFocusReleaseTimeoutRef.current = null;
                }, 220);
            };

            const renderSearchControl = (surface, extraClassName = '') => (
                <ControlField label="Search" className={`control-search ${extraClassName}`.trim()}>
                    <div className="search-wrap">
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search tickets..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onFocus={handleSearchFocus}
                            onBlur={handleSearchBlur}
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
                const options = [{ value: 'eng', label: 'ENG' }];
                if (showEpmNavigation) {
                    options.push({ value: 'epm', label: 'EPM' });
                }
                return (
                    <SegmentedControl
                        className="view-mode-control"
                        ariaLabel="Dashboard view"
                        value={showEpmNavigation ? selectedView : 'eng'}
                        onChange={(nextView) => {
                            if (nextView === 'epm' && !showEpmNavigation) return;
                            setSelectedView(nextView);
                        }}
                        options={options}
                    />
                );
            };

            const activeEngMode = showScenario
                ? 'scenario'
                : showStats
                    ? 'statistics'
                    : showPlanning
                        ? 'planning'
                        : 'catch-up';
            const applyEngMode = (mode) => {
                const nextMode = String(mode || 'catch-up');
                setShowPlanning(nextMode === 'planning');
                setShowStats(nextMode === 'statistics');
                setShowScenario(nextMode === 'scenario');
            };
            const renderEngModeControl = () => (
                <SegmentedControl
                    className="eng-mode-control"
                    ariaLabel="ENG view mode"
                    value={activeEngMode}
                    onChange={applyEngMode}
                    options={[
                        { value: 'catch-up', label: 'Catch Up', title: 'Return to default state' },
                        {
                            value: 'planning',
                            label: 'Planning',
                            disabled: !selectedSprint || isCompletedSprintSelected,
                            title: 'Show sprint planning panel'
                        },
                        {
                            value: 'statistics',
                            label: 'Statistics',
                            disabled: isFutureSprintSelected,
                            title: 'Show sprint statistics'
                        },
                        {
                            value: 'scenario',
                            label: 'Scenario',
                            disabled: !selectedSprint || isCompletedSprintSelected,
                            title: 'Show scenario planner'
                        }
                    ]}
                />
            );

            const renderEpmControls = (surface, { showProjectPicker = true, showStateControl = true } = {}) => (
                <EpmControls
                    selectedView={selectedView}
                    epmTab={epmTab}
                    setEpmTab={setEpmTab}
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
                    setEpmSelectedProjectId={setEpmSelectedProjectId}
                    setShowEpmProjectDropdown={setShowEpmProjectDropdown}
                    savedEpmSubGoalKeys={savedEpmSubGoalKeys}
                    epmSubGoalOptions={epmSubGoals}
                    selectedEpmSubGoalKeys={epmSelectedSubGoalKeys}
                    setEpmSelectedSubGoalKeys={setEpmSelectedSubGoalKeys}
                    showEpmSubGoalDropdown={showEpmSubGoalFilterDropdown}
                    setShowEpmSubGoalDropdown={setShowEpmSubGoalFilterDropdown}
                    epmSubGoalFilterDropdownRefs={epmSubGoalFilterDropdownRefs}
                />
            );

            const renderEpmProjectCollapseAllButton = (_surface) => {
                if (!showEpmProjectCollapseAllButton) return null;
                return (
                    <button
                        className="group-gear-button epm-project-collapse-all-button"
                        onClick={toggleAllVisibleEpmProjectsCollapsed}
                        title={epmProjectCollapseAllLabel}
                        aria-label={epmProjectCollapseAllLabel}
                        aria-pressed={allVisibleEpmProjectsCollapsed}
                        type="button"
                    >
                        <svg className="epm-project-collapse-all-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <g className="epm-project-collapse-all-stack">
                                <rect x="4.25" y="4.35" width="9.6" height="3.5" rx="1.1"/>
                                <rect x="4.25" y="10.25" width="9.6" height="3.5" rx="1.1"/>
                                <rect x="4.25" y="16.15" width="9.6" height="3.5" rx="1.1"/>
                            </g>
                            {allVisibleEpmProjectsCollapsed ? (
                                <g className="epm-project-collapse-all-arrows">
                                    <path d="M18 10.15V4.85"/>
                                    <path d="M15.6 7.25 18 4.85l2.4 2.4"/>
                                    <path d="M18 13.85v5.3"/>
                                    <path d="M15.6 16.75 18 19.15l2.4-2.4"/>
                                </g>
                            ) : (
                                <g className="epm-project-collapse-all-arrows">
                                    <path d="M18 4.85v5.3"/>
                                    <path d="M15.6 7.75 18 10.15l2.4-2.4"/>
                                    <path d="M18 19.15v-5.3"/>
                                    <path d="M15.6 16.25 18 13.85l2.4 2.4"/>
                                </g>
                            )}
                        </svg>
                    </button>
                );
            };

            const renderSprintControl = (surface) => (
                <ControlField label="Sprint">
                    <div className="sprint-dropdown" ref={(node) => { sprintDropdownRefs.current[surface] = node; }}>
                        <div
                            className={`sprint-dropdown-toggle ${showSprintDropdown ? 'open' : ''}`}
                            role="button"
                            aria-label="Select sprint"
                            tabIndex={sprintsLoading || availableSprints.length === 0 ? -1 : 0}
                            onClick={() => {
                                if (sprintsLoading || availableSprints.length === 0) return;
                                applyExclusiveDropdownState('sprint', showSprintDropdown);
                            }}
                            onKeyDown={(event) => {
                                if (sprintsLoading || availableSprints.length === 0) return;
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    applyExclusiveDropdownState('sprint', showSprintDropdown);
                                }
                            }}
                            aria-disabled={sprintsLoading || availableSprints.length === 0}
                        >
                            <span>{sprintName || 'Sprint'}</span>
                            <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                <path d="M6 9L1 4h10z"/>
                            </svg>
                        </div>
                        {showSprintDropdown && surface === activeControlSurface && (
                            <div className="sprint-dropdown-panel">
                                <input
                                    type="text"
                                    className="sprint-dropdown-search"
                                    placeholder="Filter..."
                                    value={sprintSearch}
                                    onChange={(e) => setSprintSearch(e.target.value)}
                                    aria-label="Filter sprints"
                                />
                                <div className="sprint-dropdown-list">
                                    {sprintsLoading ? (
                                        <div className="sprint-dropdown-option">Loading sprints...</div>
                                    ) : filteredSprints.length === 0 ? (
                                        <div className="sprint-dropdown-option">No sprints available</div>
                                    ) : (
                                        filteredSprints.map(sprint => {
                                            const state = (sprint.state || '').toLowerCase();
                                            const marker = state === 'closed' ? '[C]' : state === 'active' ? '[A]' : '[F]';
                                            return (
                                                <div
                                                    key={sprint.id}
                                                    className="sprint-dropdown-option"
                                                    data-sprint-id={sprint.id}
                                                    onClick={() => {
                                                        setSelectedSprint(sprint.id);
                                                        setSprintName(sprint.name);
                                                        setShowSprintDropdown(false);
                                                    }}
                                                >
                                                    {marker} {sprint.name}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </ControlField>
            );

            const renderGroupControl = (surface) => {
                if (!showGroupControl) return null;
                return (
                    <div className="group-control">
                        <ControlField label="Group">
                            <div className="group-dropdown" ref={(node) => { groupDropdownRefs.current[surface] = node; }}>
                                <div
                                    className={`group-dropdown-toggle ${showGroupDropdown ? 'open' : ''}`}
                                    role="button"
                                    aria-label="Select group"
                                    tabIndex={groupsLoading ? -1 : 0}
                                    onClick={() => {
                                        if (groupsLoading) return;
                                        applyExclusiveDropdownState('group', showGroupDropdown);
                                    }}
                                    onKeyDown={(event) => {
                                        if (groupsLoading) return;
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            applyExclusiveDropdownState('group', showGroupDropdown);
                                        }
                                    }}
                                    aria-disabled={groupsLoading}
                                >
                                    <span>{activeGroup?.name || (groupsLoading ? 'Loading...' : 'Group')}</span>
                                    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                        <path d="M6 9L1 4h10z"/>
                                    </svg>
                                </div>
                                {showGroupDropdown && surface === activeControlSurface && (
                                    <div className="group-dropdown-panel">
                                        {groupsLoading ? (
                                            <div className="group-dropdown-option">Loading groups...</div>
                                        ) : (groupsConfig.groups || []).length === 0 ? (
                                            <div className="group-dropdown-option">No groups yet</div>
                                        ) : (
                                            (groupsConfig.groups || []).map(group => (
                                                <div
                                                    key={group.id}
                                                    className="group-dropdown-option"
                                                    onClick={() => {
                                                        setActiveGroupId(group.id);
                                                        setShowGroupDropdown(false);
                                                    }}
                                                >
                                                    <span>{group.name}</span>
                                                    <div className="group-option-tags">
                                                        {groupsConfig.defaultGroupId === group.id && (
                                                            <span className="group-option-default" title="Default group">★</span>
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
                    <div className="team-dropdown" ref={(node) => { teamDropdownRefs.current[surface] = node; }}>
                        <div
                            className={`team-dropdown-toggle ${showTeamDropdown ? 'open' : ''}`}
                            role="button"
                            aria-label="Filter teams"
                            tabIndex={tasks.length === 0 && loading ? -1 : 0}
                            onClick={() => {
                                if (tasks.length === 0 && loading) return;
                                applyExclusiveDropdownState('team', showTeamDropdown);
                            }}
                            onKeyDown={(event) => {
                                if (tasks.length === 0 && loading) return;
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    applyExclusiveDropdownState('team', showTeamDropdown);
                                }
                            }}
                            aria-disabled={tasks.length === 0 && loading}
                        >
                            <span style={{flex: 1, display: 'grid', textAlign: 'left', minWidth: 0}}>
                                <span style={{gridArea: '1/1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{selectedTeamsLabel}</span>
                                <span style={{gridArea: '1/1', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap'}} aria-hidden="true">{longestTeamOptionLabel}</span>
                            </span>
                            <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                <path d="M6 9L1 4h10z"/>
                            </svg>
                        </div>
                        {showTeamDropdown && surface === activeControlSurface && (
                            <div className="team-dropdown-panel">
                                {teamOptions.map(team => (
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

            const retryServerConnection = () => {
                clearServerConnectionError();
                setError('');
                void refreshHomeTokenConnectionStatus();
                void loadConfig();
                void loadGroupsConfig();
                void loadSelectedProjects();
                void loadPriorityWeightsConfig();
                void loadSprints(true);
                if (selectedView === 'epm') {
                    void refreshEpmView();
                }
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
                        return (
                            <div
                                key={epicGroup.key}
                                className={`epic-block ${excludedEpicSet.has(normalizeEpicKey(epicGroup.key)) ? 'epic-excluded' : ''} ${stickyEpicFocusKey === epicGroup.key ? 'epic-block-sticky-focus' : ''}`}
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
                                            {epicGroup.key !== 'NO_EPIC' ? (
                                                <a
                                                    className="epic-link"
                                                    href={jiraUrl ? `${jiraUrl}/browse/${epicGroup.key}` : '#'}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    <span className="epic-name">{epicTitle}</span>
                                                    <span className="epic-key">{epicGroup.key}</span>
                                                </a>
                                            ) : (
                                                <>
                                                    <span className="epic-name">{epicTitle}</span>
                                                    <span className="epic-key">Unassigned</span>
                                                </>
                                            )}
                                            {(showStats || showPlanning) && (
                                                <button
                                                    className={`epic-stat-toggle ${excludedEpicSet.has(normalizeEpicKey(epicGroup.key)) ? '' : 'active'}`}
                                                    onClick={() => {
                                                        const epicKey = String(epicGroup.key || 'NO_EPIC').trim().toUpperCase();
                                                        setExcludedStatsEpics((prev) => {
                                                            const set = new Set(prev || []);
                                                            if (set.has(epicKey)) {
                                                                set.delete(epicKey);
                                                            } else {
                                                                set.add(epicKey);
                                                            }
                                                            return Array.from(set);
                                                        });
                                                    }}
                                                    title="Include/exclude epic in sprint stats and planning capacity"
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
                                                <StatusPill
                                                    className={epicStatusClassName}
                                                    label={epicStatus}
                                                />
                                            )}
	                                        <span>SP: {epicTotalSp.toFixed(1)}</span>
	                                        {epicInfo?.assignee?.displayName && (
	                                            <span className="task-assignee epic-assignee">
	                                                <span className="task-assignee-icon" aria-hidden="true">
	                                                    <svg viewBox="0 0 24 24" fill="none">
	                                                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" stroke="currentColor" strokeWidth="2" />
	                                                        <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
	                                                    </svg>
	                                                </span>
	                                                <span>{epicInfo.assignee.displayName}</span>
	                                            </span>
	                                        )}
	                                    </div>
	                                </div>
                                {epicGroup.tasks.map(task => {
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
                                            shouldRenderIssueDependencies={shouldRenderIssueDependencies}
                                            dependencyContext={issueDependencyContext}
                                        />
                                    );
                                })}
                            </div>
                        );
            };

            const activeSettingsModalTab = ADMIN_SETTINGS_TAB_IDS.has(groupManageTab)
                ? 'admin'
                : DEPARTMENT_SETTINGS_TAB_IDS.has(groupManageTab)
                    ? 'departments'
                    : groupManageTab;
            const activeDepartmentSettingsTab = departmentSettingsTab === 'labels' && !labelsTabEnabled
                ? 'teams'
                : departmentSettingsTab;
            const settingsModalAllTabs = [
                {
                    id: 'admin',
                    label: 'Admin',
                    onClick: () => setGroupManageTab(adminSettingsTab)
                },
                {
                    id: 'departments',
                    label: 'Departments',
                    onClick: () => setGroupManageTab(activeDepartmentSettingsTab)
                },
                {
                    id: 'connections',
                    label: 'Connections',
                    onClick: openUserConnectionsSettings
                },
                {
                    id: 'epm',
                    label: 'EPM',
                    onClick: openEpmSettingsTab
                }
            ];
            const settingsModalTabs = settingsModalAllTabs.filter(tab => {
                if (tab.id === 'epm') return canEditEpmConfiguration;
                if (tab.id === 'admin') return canEditSharedConfiguration;
                return true;
            });
            const settingsSaveHandler = groupManageTab === 'epm'
                ? () => { void saveEpmConfig().catch(() => {}); }
                : saveGroupsConfig;
            const settingsShowsSave = groupManageTab !== 'connections';
            const settingsSaveDisabled = groupManageTab === 'epm'
                ? (!canEditEpmConfiguration || epmConfigLoading || epmConfigSaving)
                : Boolean(saveBlockedReason);
            const settingsSaveTitle = groupManageTab === 'epm' ? '' : (saveBlockedReason || '');
            const settingsSaveLabel = groupManageTab === 'epm'
                ? (epmConfigSaving ? 'Saving EPM...' : 'Save EPM settings')
                : (groupSaving ? 'Saving...' : 'Save');

            return (
                <div className="container" style={containerStyle}>
                    <header ref={headerRef}>
                        <div className="subtitle">
                            <span className="subtitle-main">
                                <img src="epm-burst.svg" alt="" className="subtitle-logo" aria-hidden="true" />
                                Jira Execution Planner
                                <span className="subtitle-secondary"> · Product &amp; Tech Projects</span>
                                {updateNoticeVisible && (
                                    <button
                                        type="button"
                                        className={`update-badge ${searchActive ? 'compact' : ''}`}
                                        onClick={() => setShowUpdateModal(true)}
                                        aria-label="New version available"
                                        title="A new version is available"
                                    >
                                        {searchActive ? 'Update' : 'New version available'}
                                    </button>
                                )}
                            </span>
                            <div className="header-actions">
                                <div className="header-actions-row">
                                    {renderViewSwitch()}
                                    {renderSearchControl('main')}
                                    <JiraExportButton
                                        jiraUrl={jiraUrl}
                                        epicKeys={activeJiraExportEpicKeys}
                                        storyKeys={activeJiraExportStoryKeys}
                                        className="jira-export-header"
                                    />
                                    <IconButton
                                        variant="secondary compact"
                                        className="refresh-icon"
                                        isLoading={selectedView === 'epm' && epmProjectsLoading}
                                        onClick={() => {
                                            if (selectedView === 'epm') {
                                                void refreshEpmView();
                                                return;
                                            }
                                            if (activeGroupId) {
                                                groupStateRef.current.delete(activeGroupId);
                                            }
                                            burnoutCacheRef.current = {};
                                            cohortCacheRef.current = {};
                                            excludedCapacityCacheRef.current = {};
                                            loadSprints(true);
                                            if (isStatsSourceOnlyStatsView) {
                                                excludedCapacityForceRefreshRef.current = true;
                                                setExcludedCapacityData(null);
                                                setExcludedCapacityError('');
                                                setExcludedCapacityRefreshNonce(prev => prev + 1);
                                                return;
                                            }
                                            loadProductTasks({ forceRefresh: true });
                                            loadTechTasks({ forceRefresh: true });
                                            loadReadyToCloseProductTasks({ forceRefresh: true });
                                            loadReadyToCloseTechTasks({ forceRefresh: true });
                                        }}
                                        disabled={selectedView === 'eng' ? (loading || selectedSprint === null) : (epmProjectsLoading || epmRollupLoading)}
                                        title={selectedView === 'eng' ? 'Refresh tasks and sprints from Jira' : 'Refresh EPM projects and issues from Jira'}
                                        aria-label={selectedView === 'eng' ? 'Refresh tasks and sprints from Jira' : 'Refresh EPM projects and issues from Jira'}
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="M19 7.5a7.5 7.5 0 1 0 2 5.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
                                            <path d="M19 3v4h-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </IconButton>
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
                                {selectedView === 'eng' && (
                                    <button
                                        className="group-gear-button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            openGroupManage();
                                        }}
                                        disabled={groupsLoading}
                                        title="Manage team groups"
                                        aria-label="Manage team groups"
                                        type="button"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" stroke="currentColor" strokeWidth="1.6"/>
                                            <path d="M19.4 12a7.5 7.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.1-1.2l-.4-2.6H9.6l-.4 2.6a7.4 7.4 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0-.1 1.2c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2l.4 2.6h4.8l.4-2.6c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </button>
                                )}
                                {selectedView === 'epm' && (
                                    <>
                                        {renderEpmProjectCollapseAllButton('main')}
                                        {canEditEpmConfiguration && (
                                            <button
                                                className="group-gear-button"
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
                                    </>
                                )}
                            </div>
                        </div>
                    </header>

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
                                            {renderEpmProjectCollapseAllButton('compact')}
                                        </>
                                    )}
                                </div>
                                <div className="compact-sticky-header-search">
                                    {renderSearchControl('compact', 'compact-sticky-header-search-field')}
                                </div>
                            </>
                        )}
                    </div>

                    {serverConnectionError && (
                        <div className="server-unavailable-banner" role="alert">
                            <div>
                                <div className="server-unavailable-title">Server is not responding</div>
                                <p>{serverConnectionError}</p>
                            </div>
                            <button type="button" onClick={retryServerConnection}>
                                Retry connection
                            </button>
                        </div>
                    )}

                    {selectedView === 'eng' && !isCompletedSprintSelected && (
                        <div className={`capacity-panel ${showPlanning ? 'open' : ''}`}>
                            <div className="capacity-header">
                                <div className="capacity-title">Planned Teams Effort (Story Points)</div>
                                <div className="capacity-subtitle">1 SP ≈ 2 days of work</div>
                            </div>
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
                                            <div className="capacity-cell capacity-team">{info.name}</div>
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

                    {selectedView === 'eng' && showStats && (
                    <div className={`stats-panel ${showStats ? 'open' : ''}`}>
                        {showStats && !canRenderStatsPanel && (
                            <div className="stats-note">Load stats for the selected sprint.</div>
                        )}

                        {canRenderStatsPanel && (
                            <>
                                <SegmentedControl
                                    className="eng-mode-control stats-view-toggle"
                                    ariaLabel="Statistics view"
                                    value={statsView}
                                    onChange={setStatsView}
                                    options={[
                                        { value: 'teams', label: 'Teams' },
                                        { value: 'priority', label: 'Priority' },
                                        { value: 'burnout', label: 'Burndown' },
                                        { value: 'cohort', label: 'Lead Times' },
                                        { value: 'excludedCapacity', label: 'Excluded Capacity' },
                                        { value: 'monoCrossShare', label: 'Mono vs Cross' }
                                    ]}
                                />

                                {statsView !== 'cohort' && statsView !== 'excludedCapacity' && statsView !== 'monoCrossShare' && (
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
                                    resolveTeamColor={resolveTeamColor}
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
                                />
                                <div className={`stats-view ${statsView === 'excludedCapacity' ? 'open' : ''}`}>
                                    <div className="stats-controls excluded-capacity-controls excluded-capacity-filter-controls">
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
                                                                onClick={() => {
                                                                    if (excludedCapacityAutoEpicKeys.length > 0) {
                                                                        selectAutoExcludedCapacityEpics();
                                                                    }
                                                                }}
                                                                aria-disabled={excludedCapacityAutoEpicKeys.length === 0}
                                                            >
                                                                BAU / ad hoc
                                                            </div>
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
                                        <div className="stats-control-group excluded-capacity-sprint-control excluded-capacity-start-sprint-control">
                                            <label>Start Sprint</label>
                                            <select
                                                className="scenario-input"
                                                value={excludedCapacityStartSprintId}
                                                onChange={(event) => setExcludedCapacityStartSprintId(event.target.value)}
                                            >
                                                {excludedCapacitySprintOptions.map((sprint) => (
                                                    <option key={sprint.id} value={String(sprint.id)}>{sprint.name || sprint.id}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="stats-control-group excluded-capacity-sprint-control excluded-capacity-end-sprint-control">
                                            <label>End Sprint</label>
                                            <select
                                                className="scenario-input"
                                                value={excludedCapacityEndSprintId}
                                                onChange={(event) => setExcludedCapacityEndSprintId(event.target.value)}
                                            >
                                                {excludedCapacitySprintOptions.map((sprint) => (
                                                    <option key={sprint.id} value={String(sprint.id)}>{sprint.name || sprint.id}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="excluded-capacity-actions">
                                        <SegmentedControl
                                            ariaLabel="Series mode"
                                            value={excludedCapacityChartMode}
                                            onChange={setExcludedCapacityChartMode}
                                            options={[
                                                { value: 'teams', label: 'Teams' },
                                                { value: 'group', label: 'Group' }
                                            ]}
                                        />
                                        <SegmentedControl
                                            ariaLabel="Metric"
                                            value={excludedCapacityMetric}
                                            onChange={setExcludedCapacityMetric}
                                            options={[
                                                { value: 'percent', label: 'Percentage' },
                                                { value: 'storyPoints', label: 'Story Points' }
                                            ]}
                                        />
                                    </div>

                                    <div className="stats-summary excluded-capacity-summary">
                                        <div className="stats-card">
                                            <h4>Range</h4>
                                            <div className="stat-value">{excludedCapacitySprintRange.length}</div>
                                            <div className="stats-note">Selected Jira sprints</div>
                                        </div>
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
                                            <h4>Product Share</h4>
                                            <div className="stat-value">{formatPercent(effortSplitTotals.productPercent)}</div>
                                            <div className="stats-note">Approximate, story-point based</div>
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
                                    {excludedCapacityError && excludedCapacityRows.length === 0 && (
                                        <div className="stats-note cohort-error">{excludedCapacityError}</div>
                                    )}
                                    {!excludedCapacityError && excludedCapacityWarnings.length > 0 && (
                                        <div className="cohort-warnings">
                                            {excludedCapacityWarnings.map((warning, index) => (
                                                <div key={`${warning}-${index}`}>- {warning}</div>
                                            ))}
                                        </div>
                                    )}
                                    {!excludedCapacityLoading && !excludedCapacityError && excludedCapacityRows.length === 0 && (
                                        <div className="cohort-empty">No excluded capacity stories found in the selected sprint range.</div>
                                    )}
                                    {!excludedCapacityError && excludedCapacityRows.length > 0 && (
                                        <div className="excluded-capacity-panel">
                                            <div className="cohort-section cohort-section-fullbleed">
                                                <div className="cohort-section-title">Effort Split</div>
                                                <div className="cohort-section-subtitle">
                                                    Selected sprint-range story points by Excluded Capacity, Tech, and Product.
                                                </div>
                                                <div className="cohort-section-subtitle">
                                                    Sprint range: {effortSplitSprintLabel}
                                                </div>
                                                <EffortTypeSplitChart
                                                    rows={effortSplitRows}
                                                    metric={excludedCapacityMetric}
                                                    visibleBuckets={effortSplitVisibleBuckets}
                                                    onToggleBucket={toggleEffortSplitBucket}
                                                    formatExcludedPoints={formatExcludedPoints}
                                                    formatPercent={formatPercent}
                                                />
                                            </div>
                                            <div className="cohort-section cohort-section-fullbleed">
                                                <div className="cohort-section-title">Excluded Capacity by Team and Sprint</div>
                                                <ExcludedCapacityLineChart
                                                    series={excludedCapacityLineSeries.series}
                                                    sprints={excludedCapacityLineSeries.sprints}
                                                    metric={excludedCapacityMetric}
                                                    mode={excludedCapacityLineSeries.mode}
                                                    isolatedSeriesId={excludedCapacityIsolatedTeam}
                                                    onSelectSeries={setExcludedCapacityIsolatedTeam}
                                                    resolveTeamColor={resolveTeamColor}
                                                    formatExcludedPoints={formatExcludedPoints}
                                                    formatPercent={formatPercent}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className={`stats-view ${statsView === 'monoCrossShare' ? 'open' : ''}`}>
                                    <div className="stats-controls excluded-capacity-controls">
                                        <div className="stats-control-group">
                                            <label>Start Sprint</label>
                                            <select
                                                className="scenario-input"
                                                value={excludedCapacityStartSprintId}
                                                onChange={(event) => setExcludedCapacityStartSprintId(event.target.value)}
                                            >
                                                {excludedCapacitySprintOptions.map((sprint) => (
                                                    <option key={sprint.id} value={String(sprint.id)}>{sprint.name || sprint.id}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="stats-control-group">
                                            <label>End Sprint</label>
                                            <select
                                                className="scenario-input"
                                                value={excludedCapacityEndSprintId}
                                                onChange={(event) => setExcludedCapacityEndSprintId(event.target.value)}
                                            >
                                                {excludedCapacitySprintOptions.map((sprint) => (
                                                    <option key={sprint.id} value={String(sprint.id)}>{sprint.name || sprint.id}</option>
                                                ))}
                                            </select>
                                        </div>
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
                                                    resolveTeamColor={resolveTeamColor}
                                                    formatExcludedPoints={formatExcludedPoints}
                                                    formatPercent={formatPercent}
                                                    ariaLabel="Team cross share per sprint"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className={`stats-view ${statsView === 'cohort' ? 'open' : ''}`}>
                                    <div className="stats-controls cohort-controls">
                                        <div className="stats-control-group">
                                            <label>Start Quarter</label>
                                            <select
                                                className="scenario-input"
                                                value={cohortStartQuarter}
                                                onChange={(event) => {
                                                    setCohortStartQuarter(event.target.value);
                                                    setCohortSelectedRow(null);
                                                }}
                                            >
                                                {cohortQuarterOptions.map((quarterLabel) => (
                                                    <option key={quarterLabel} value={quarterLabel}>{quarterLabel}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="stats-control-group">
                                            <label>Group By</label>
                                            <select
                                                className="scenario-input"
                                                value={cohortGroupBy}
                                                onChange={(event) => {
                                                    setCohortGroupBy(event.target.value === 'month' ? 'month' : 'quarter');
                                                    setCohortSelectedRow(null);
                                                }}
                                            >
                                                <option value="quarter">Quarter</option>
                                                <option value="month">Month</option>
                                            </select>
                                        </div>
                                        <div className="stats-control-group">
                                            <label>Project</label>
                                            <select
                                                className="scenario-input"
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
                                            <label>Assignee</label>
                                            <select
                                                className="scenario-input"
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
                                    </div>

                                    <div className="stats-actions cohort-status-actions">
                                        <button
                                            className={`stats-toggle ${cohortExcludeCapacity ? 'active' : ''}`}
                                            onClick={() => {
                                                setCohortExcludeCapacity((prev) => !prev);
                                                setCohortSelectedRow(null);
                                            }}
                                            type="button"
                                        >
                                            Excluded Capacity
                                        </button>
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
                                        <div className="stats-card">
                                            <h4>In Progress / Postponed</h4>
                                            <div className="stat-value">{cohortSummary.open}</div>
                                            <div className="stats-note">{cohortSummary.postponed} postponed</div>
                                        </div>
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
                                            <div className="cohort-section">
                                                <OpenEpicsChart
                                                    title={cohortSelectedRowLabel
                                                        ? `Open Epics (${cohortSelectedRowLabel})`
                                                        : 'Open Epics (All Cohorts)'}
                                                    items={cohortOpenBars}
                                                    jiraBaseUrl={jiraUrl}
                                                />
                                            </div>
                                            <div className="cohort-section">
                                                <OpenEpicsChart
                                                    title={cohortSelectedRowLabel
                                                        ? `Completed Epics — Lead Time (${cohortSelectedRowLabel})`
                                                        : 'Completed Epics — Lead Time (All Cohorts)'}
                                                    items={cohortCompletedBars}
                                                    jiraBaseUrl={jiraUrl}
                                                    emptyMessage="No completed epics in this scope."
                                                    variant="completed"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                    )}

                    {selectedView === 'eng' && showScenario && (
                        <div className="scenario-fullbleed">
                            <div className="scenario-panel open">
                                <div className="scenario-inner">
                                    <div className="scenario-header">
                                        <div>
                                            <div className="scenario-title">
                                                Scenario Planner
                                                <span className="scenario-beta">Beta</span>
                                            </div>
                                            <div className="scenario-subtitle">Capacity comes from Jira capacity issues (watchers + 1 dev lead).</div>
                                        </div>
                                        <div className="scenario-controls">
                                            <div className="scenario-control">
                                                <label>Lane Mode</label>
                                                <div className="scenario-toggle-group">
                                                    <button
                                                        className={`scenario-toggle ${scenarioLaneMode === 'team' ? 'active' : ''}`}
                                                        onClick={() => {
                                                            if (scenarioEpicFocus) clearScenarioEpicFocus();
                                                            setScenarioLaneMode('team');
                                                        }}
                                                    >
                                                        Team
                                                    </button>
                                                    <button
                                                        className={`scenario-toggle ${scenarioLaneMode === 'epic' ? 'active' : ''}`}
                                                        onClick={() => {
                                                            if (scenarioEpicFocus) clearScenarioEpicFocus();
                                                            setScenarioLaneMode('epic');
                                                        }}
                                                    >
                                                        Epic
                                                    </button>
                                                    <button
                                                        className={`scenario-toggle ${scenarioLaneMode === 'assignee' ? 'active' : ''}`}
                                                        onClick={() => {
                                                            if (scenarioEpicFocus) clearScenarioEpicFocus();
                                                            setScenarioLaneMode('assignee');
                                                        }}
                                                    >
                                                        Assignee
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="scenario-controls-separator" />
                                            <button
                                                className={`scenario-toggle ${scenarioSummaryHidden ? '' : 'active'}`}
                                                onClick={() => setScenarioSummaryHidden(prev => !prev)}
                                                title={scenarioSummaryHidden ? 'Show summary cards' : 'Hide summary cards'}
                                            >
                                                {scenarioSummaryHidden ? 'Show Summary' : 'Hide Summary'}
                                            </button>
                                            <button
                                                className={`scenario-edit-toggle ${scenarioEditMode ? 'active' : ''}`}
                                                onClick={toggleScenarioEditMode}
                                                disabled={!scenarioData}
                                            >
                                                {scenarioEditMode ? 'Exit Edit' : 'Edit'}
                                            </button>
                                            {scenarioData && !scenarioEditMode && (
                                                <button
                                                    type="button"
                                                    ref={scenarioHistoryButtonRef}
                                                    className="scenario-toggle"
                                                    onClick={openScenarioDraftHistory}
                                                    disabled={scenarioDraftMeta.loadingHistory}
                                                >
                                                    History
                                                </button>
                                            )}
                                            <button
                                                className={`scenario-toggle ${scenarioShowConflictsOnly ? 'active' : ''}`}
                                                onClick={() => setScenarioShowConflictsOnly(prev => !prev)}
                                            >
                                                Conflicts Only
                                            </button>
                                            <button
                                                className="secondary"
                                                onClick={runScenario}
                                                disabled={scenarioLoading || !selectedSprint}
                                            >
                                                {scenarioLoading ? 'Running...' : 'Run Scenario'}
                                            </button>
                                            {scenarioEditMode && (
                                                <>
                                                    <button
                                                        className="scenario-edit-toggle"
                                                        onClick={scenarioUndo}
                                                        disabled={!scenarioUndoStackRef.current.canUndo()}
                                                        title="Undo (Ctrl+Z)"
                                                    >
                                                        Undo
                                                    </button>
                                                    <button
                                                        className="scenario-edit-toggle"
                                                        onClick={scenarioRedo}
                                                        disabled={!scenarioUndoStackRef.current.canRedo()}
                                                        title="Redo (Ctrl+Shift+Z)"
                                                    >
                                                        Redo
                                                    </button>
                                                    <button
                                                        className="scenario-edit-toggle"
                                                        onClick={saveScenarioDraft}
                                                        disabled={!scenarioCanSaveDraft}
                                                        title="Save draft overrides to server"
                                                    >
                                                        {scenarioDraftMeta.saving ? 'Saving...' : 'Save Draft'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        ref={scenarioHistoryButtonRef}
                                                        className="scenario-edit-toggle"
                                                        onClick={openScenarioDraftHistory}
                                                        disabled={scenarioDraftMeta.loadingHistory}
                                                    >
                                                        History
                                                    </button>
                                                    <button
                                                        className="scenario-edit-toggle"
                                                        onClick={discardScenarioOverrides}
                                                        disabled={!scenarioHasUnsavedChanges}
                                                        title="Discard all overrides"
                                                    >
                                                        Discard
                                                    </button>
                                                    {scenarioOverrideCount > 0 && (
                                                        <span className="scenario-dirty-indicator">{scenarioOverrideCount} override{scenarioOverrideCount !== 1 ? 's' : ''}</span>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {scenarioRemoteEditors.length > 0 && (
                                        <div className="scenario-draft-history-note" role="status" aria-live="polite">
                                            Editing now: {scenarioRemoteEditors.map(item => item.displayName).join(', ')}
                                        </div>
                                    )}
                                    {scenarioDraftRealtimeStatus.paused && (
                                        <div className="scenario-draft-history-note" role="status" aria-live="polite">
                                            Realtime paused: {scenarioDraftRealtimeStatus.message || 'keep editing local-only'}
                                        </div>
                                    )}
                                    {scenarioError && <div className="scenario-error" role="alert">{scenarioError}</div>}
                                    {scenarioDraftMeta.error && (
                                        <div className="scenario-error" role="alert">{scenarioDraftMeta.error}</div>
                                    )}
                                    {scenarioDraftMeta.message && (
                                        <div className="scenario-draft-history-note" aria-live="polite">{scenarioDraftMeta.message}</div>
                                    )}
                                    {scenarioIssueLockWarnings.map(lock => (
                                        <div key={`${lock.issueKey}-${lock.holderDisplayName}`} className="scenario-error" role="alert">
                                            {lock.holderDisplayName} is editing {lock.issueKey}. Advisory lock only; local edits stay available.
                                        </div>
                                    ))}
                                    {scenarioDraftMeta.staleDraft && (
                                        <div className="scenario-error" role="alert">
                                            <span>
                                                Newer draft available at revision {scenarioDraftMeta.staleDraft.draftRevision || 'unknown'}
                                                {scenarioDraftMeta.staleDraft.updatedBy ? ` by ${scenarioDraftMeta.staleDraft.updatedBy}` : ''}. Local edits were not changed.
                                            </span>
                                            <button
                                                type="button"
                                                className="scenario-link"
                                                onClick={openScenarioDraftHistory}
                                            >
                                                Review history
                                            </button>
                                            <button
                                                type="button"
                                                className="scenario-link"
                                                onClick={requestReloadActiveDraft}
                                                disabled={scenarioDraftMeta.loadingActiveDraft}
                                            >
                                                {scenarioDraftMeta.loadingActiveDraft ? 'Reloading active draft...' : 'Reload active draft'}
                                            </button>
                                            <button
                                                type="button"
                                                className="scenario-link"
                                                onClick={() => setScenarioDraftMeta(prev => ({
                                                    ...prev,
                                                    dirtyState: scenarioHasUnsavedChanges ? 'dirty' : 'clean',
                                                    staleDraft: null,
                                                    message: '',
                                                    error: ''
                                                }))}
                                            >
                                                Keep editing locally
                                            </button>
                                            {scenarioDraftMeta.pendingActiveDraftReload && (
                                                <div className="scenario-draft-history-confirmation">
                                                    Reload active draft and replace local edits?
                                                    <button
                                                        type="button"
                                                        className="scenario-link"
                                                        onClick={runReloadActiveDraft}
                                                    >
                                                        Confirm reload active draft
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="scenario-link"
                                                        onClick={cancelReloadActiveDraft}
                                                    >
                                                        Cancel active draft reload
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {scenarioDraftMeta.conflict && (
                                        <div className="scenario-error" role="alert">
                                            <span>
                                                Scenario draft conflict. Current draft revision {scenarioDraftMeta.conflict.currentDraftRevision || 'unknown'}, version {scenarioDraftMeta.conflict.currentVersionNumber || 'unknown'}
                                                {scenarioDraftMeta.conflict.activeDraft?.updatedBy ? ` by ${scenarioDraftMeta.conflict.activeDraft.updatedBy}` : ''}
                                                {scenarioDraftMeta.conflict.activeDraft?.updatedAt ? ` at ${scenarioDraftMeta.conflict.activeDraft.updatedAt}` : ''}.
                                            </span>
                                            <button
                                                type="button"
                                                className="scenario-link"
                                                onClick={() => setScenarioDraftMeta(prev => ({
                                                    ...prev,
                                                    dirtyState: 'dirty_local',
                                                    conflict: null,
                                                    error: '',
                                                    message: ''
                                                }))}
                                            >
                                                Keep Editing
                                            </button>
                                            <button
                                                type="button"
                                                className="scenario-link"
                                                onClick={openScenarioDraftHistory}
                                            >
                                                Review history
                                            </button>
                                        </div>
                                    )}
                                    {scenarioDraftMeta.historyOpen && (
                                        <section
                                            ref={scenarioHistoryPanelRef}
                                            className="scenario-draft-history-panel"
                                            role="dialog"
                                            aria-modal="false"
                                            aria-labelledby="scenario-draft-history-title"
                                        >
                                            <div
                                                id="scenario-draft-history-title"
                                                ref={scenarioHistoryTitleRef}
                                                className="scenario-draft-history-title"
                                                tabIndex={-1}
                                            >
                                                Scenario draft history
                                            </div>
                                            {scenarioDraftMeta.versions.length === 0 ? (
                                                <div className="scenario-draft-history-note">No draft versions yet.</div>
                                            ) : (
                                                <div className="scenario-draft-history-list">
                                                    {scenarioDraftMeta.versions.map(version => {
                                                        const versionNumber = Number(version.versionNumber || 0);
                                                        const overrideCount = Number.isFinite(Number(version.overrideCount))
                                                            ? Number(version.overrideCount)
                                                            : Object.keys(version.overrides || {}).length;
                                                        const isCurrent = versionNumber === Number(scenarioDraftMeta.conflict?.currentVersionNumber || scenarioDraftMeta.activeDraft?.versionNumber || 0);
                                                        const isLoaded = versionNumber === Number(scenarioDraftMeta.loadedVersionNumber || 0);
                                                        const pendingAction = scenarioDraftMeta.pendingHistoryAction?.versionNumber === versionNumber
                                                            ? scenarioDraftMeta.pendingHistoryAction
                                                            : null;
                                                        const actor = version.createdBy || version.updatedBy || 'Unknown actor';
                                                        const timestamp = version.createdAt || version.updatedAt || 'Unknown time';
                                                        return (
                                                            <div key={version.versionId || versionNumber} className="scenario-draft-history-row">
                                                                <div className="scenario-draft-history-main">
                                                                    <strong>Version {versionNumber}</strong>
                                                                    <span>{actor}</span>
                                                                    <span>{timestamp}</span>
                                                                    <span>{overrideCount} override{overrideCount === 1 ? '' : 's'}</span>
                                                                    {isCurrent && <span>Current</span>}
                                                                    {!isCurrent && isLoaded && <span>Loaded</span>}
                                                                </div>
                                                                <div className="scenario-draft-history-actions">
                                                                    <button
                                                                        type="button"
                                                                        className="scenario-link"
                                                                        onClick={() => requestScenarioHistoryAction('reload', versionNumber)}
                                                                        disabled={scenarioDraftMeta.loadingVersionNumber === versionNumber || scenarioDraftMeta.rollingBackVersionNumber === versionNumber}
                                                                        aria-label={`Reload version ${versionNumber}`}
                                                                    >
                                                                        Reload Version
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="scenario-link"
                                                                        onClick={() => requestScenarioHistoryAction('rollback', versionNumber)}
                                                                        disabled={scenarioDraftMeta.loadingVersionNumber === versionNumber || scenarioDraftMeta.rollingBackVersionNumber === versionNumber}
                                                                        aria-label={`Rollback to version ${versionNumber}`}
                                                                    >
                                                                        Rollback to Version
                                                                    </button>
                                                                </div>
                                                                {pendingAction && (
                                                                    <div className="scenario-draft-history-confirmation">
                                                                        {pendingAction.type === 'reload'
                                                                            ? `Reload version ${versionNumber} and replace local edits?`
                                                                            : `Rollback to version ${versionNumber} and replace local edits?`}
                                                                        <button
                                                                            type="button"
                                                                            className="scenario-link"
                                                                            onClick={() => runScenarioHistoryAction(pendingAction)}
                                                                        >
                                                                            {pendingAction.type === 'reload' ? 'Reload Version' : 'Rollback to Version'}
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="scenario-link"
                                                                            onClick={cancelScenarioHistoryAction}
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            <div className="scenario-draft-history-actions">
                                                <button
                                                    type="button"
                                                    className="scenario-link"
                                                    onClick={requestScenarioReloadFromJira}
                                                    disabled={!scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.reloadingFromJira}
                                                >
                                                    {scenarioDraftMeta.reloadingFromJira ? 'Reloading from Jira...' : 'Reload from Jira'}
                                                </button>
                                            </div>
                                            {scenarioDraftMeta.pendingReloadFromJira && (
                                                <div className="scenario-draft-history-confirmation">
                                                    Reload from Jira and replace local edits?
                                                    <button
                                                        type="button"
                                                        className="scenario-link"
                                                        onClick={runScenarioReloadFromJira}
                                                    >
                                                        Confirm reload from Jira
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="scenario-link"
                                                        onClick={cancelScenarioReloadFromJira}
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            )}
                                            <div className="scenario-draft-history-note">
                                                Jira write-back is gated. Preview is dry-run only; mutation remains disabled.
                                            </div>
                                            <div className="scenario-draft-history-actions">
                                                <button
                                                    type="button"
                                                    className="scenario-link"
                                                    onClick={previewScenarioDraftWriteback}
                                                    disabled={!scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.writebackPreviewing}
                                                >
                                                    {scenarioDraftMeta.writebackPreviewing ? 'Previewing Jira write-back...' : 'Preview Jira write-back'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="scenario-link"
                                                    onClick={checkScenarioDraftWritebackGate}
                                                    disabled={!scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.writebackChecking}
                                                >
                                                    {scenarioDraftMeta.writebackChecking ? 'Checking write-back gate...' : 'Check write-back gate'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="scenario-link"
                                                    disabled
                                                    title="Real Jira write-back requires a separate future execution plan."
                                                >
                                                    Write Back to Jira
                                                </button>
                                            </div>
                                            {scenarioDraftMeta.writebackPreview && (
                                                <div className="scenario-draft-history-note" role="status" aria-live="polite">
                                                    Jira write-back preview is dry-run only. {Array.isArray(scenarioDraftMeta.writebackPreview.changes) ? scenarioDraftMeta.writebackPreview.changes.length : 0} changes would be prepared.
                                                </div>
                                            )}
                                            {scenarioDraftMeta.writebackBlocked && (
                                                <div className="scenario-error" role="alert">
                                                    {scenarioDraftMeta.writebackBlocked.message || 'Jira write-back is blocked by the migration gate.'}
                                                </div>
                                            )}
                                            <button
                                                type="button"
                                                className="scenario-link"
                                                onClick={closeScenarioDraftHistory}
                                            >
                                                Close
                                            </button>
                                        </section>
                                    )}
                                    {scenarioLoading && <div className="scenario-loading">Computing scenario timeline...</div>}

                                    {scenarioData && (
                                        <>
                                            <div className={`scenario-summary ${scenarioSummaryHidden ? 'hidden' : ''}`}>
                                                {!scenarioSummaryHidden && scenarioAssigneeConflicts.conflicts.size > 0 && (
                                                    <div className={`scenario-card scenario-card-warning ${scenarioCollapsedCards.warnings ? 'collapsed' : ''}`}>
                                                        <h4 className="scenario-card-toggle" onClick={() => setScenarioCollapsedCards(prev => ({ ...prev, warnings: !prev.warnings }))}>
                                                            <span className="scenario-card-chevron">{scenarioCollapsedCards.warnings ? '▸' : '▾'}</span>
                                                            ⚠️ Schedule Warnings
                                                        </h4>
                                                        <div className="scenario-value">
                                                            {scenarioAssigneeConflicts.conflicts.size} conflicts
                                                        </div>
                                                        <div className="scenario-subtitle">
                                                            {Array.from(new Set(
                                                                Array.from(scenarioAssigneeConflicts.conflicts).map(key => {
                                                                    const issue = scenarioIssueByKey.get(key);
                                                                    return issue?.assignee;
                                                                }).filter(Boolean)
                                                            )).length} assignees with overlapping tasks
                                                        </div>
                                                        {!scenarioCollapsedCards.warnings && (
                                                            <div className="scenario-issues-list">
                                                                {Array.from(scenarioAssigneeConflicts.conflicts).map(key => {
                                                                    const issue = scenarioIssueByKey.get(key);
                                                                    return (
                                                                        <button
                                                                            key={key}
                                                                            type="button"
                                                                            className="scenario-link"
                                                                            onClick={() => scrollToScenarioIssue(key)}
                                                                        >
                                                                            <span>{issue?.summary || key}</span>
                                                                            <span className="scenario-link-key">{key} · {issue?.assignee}</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {!scenarioSummaryHidden && <div className={`scenario-card ${scenarioCollapsedCards.timeline ? 'collapsed' : ''}`}>
                                                    <h4 className="scenario-card-toggle" onClick={() => setScenarioCollapsedCards(prev => ({ ...prev, timeline: !prev.timeline }))}>
                                                        <span className="scenario-card-chevron">{scenarioCollapsedCards.timeline ? '▸' : '▾'}</span>
                                                        Timeline Status
                                                    </h4>
                                                    <div className="scenario-value">
                                                        {scenarioDeadlineAtRisk ? 'At risk' : 'On track'}
                                                    </div>
                                                    <div className="scenario-subtitle">
                                                        {scenarioLateItems.length} late · {scenarioCriticalPathItems.length} critical path
                                                    </div>
                                                    {!scenarioCollapsedCards.timeline && (
                                                        <div className="scenario-issues-list">
                                                            {[...scenarioLateItems, ...scenarioCriticalPathItems]
                                                                .filter((key, idx, arr) => arr.indexOf(key) === idx)
                                                                .map(key => {
                                                                const issue = scenarioIssueByKey.get(key);
                                                                const isLate = scenarioLateItems.includes(key);
                                                                return (
                                                                    <button
                                                                        type="button"
                                                                        key={key}
                                                                        className="scenario-link"
                                                                        onClick={() => scrollToScenarioIssue(key)}
                                                                    >
                                                                        <span>{issue?.summary || key}</span>
                                                                        <span className="scenario-link-key">{key}{isLate ? ' · Late' : ' · Critical'}</span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>}
                                                {!scenarioSummaryHidden && <div className={`scenario-card ${scenarioCollapsedCards.unschedulable ? 'collapsed' : ''}`}>
                                                    <h4 className="scenario-card-toggle" onClick={() => setScenarioCollapsedCards(prev => ({ ...prev, unschedulable: !prev.unschedulable }))}>
                                                        <span className="scenario-card-chevron">{scenarioCollapsedCards.unschedulable ? '▸' : '▾'}</span>
                                                        Unschedulable
                                                    </h4>
                                                    <div className="scenario-value">{scenarioUnschedulableItems.length}</div>
                                                    <div className="scenario-subtitle">Missing SP or dependencies</div>
                                                    {!scenarioCollapsedCards.unschedulable && (
                                                        <div className="scenario-issues-list">
                                                            {scenarioUnschedulableItems.map(key => {
                                                                const issue = scenarioIssueByKey.get(key);
                                                                const reason = issue?.scheduledReason;
                                                                let reasonLabel = '';
                                                                if (reason === 'missing_story_points') {
                                                                    reasonLabel = 'Missing SP';
                                                                } else if (reason === 'missing_dependency') {
                                                                    reasonLabel = 'Missing dependency';
                                                                }
                                                                return (
                                                                    <button
                                                                        type="button"
                                                                        key={key}
                                                                        className="scenario-link"
                                                                        onClick={() => scrollToScenarioIssue(key)}
                                                                    >
                                                                        <span>{issue?.summary || key}</span>
                                                                        <span className="scenario-link-key">
                                                                            {key}{reasonLabel ? ` · ${reasonLabel}` : ''}
                                                                        </span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>}
                                            </div>

                                            {scenarioEpicFocus && (
                                                <div className="scenario-focus-indicator">
                                                    <button
                                                        type="button"
                                                        className="scenario-focus-exit"
                                                        onClick={clearScenarioEpicFocus}
                                                    >
                                                        <span>Focused: {scenarioEpicFocus.summary || scenarioEpicFocus.key} (click to exit)</span>
                                                    </button>
                                                </div>
                                            )}
                                            <div className="scenario-timeline" ref={scenarioTimelineRef}>
                                                <div className="scenario-axis">
                                                    <div className="scenario-axis-ticks">
                                                        {scenarioTicks.map((tick) => {
                                                            const left = `${tick.ratio * 100}%`;
                                                            return (
                                                                <span
                                                                    key={tick.label}
                                                                    className="scenario-axis-tick"
                                                                    style={{ left }}
                                                                >
                                                                    {tick.label}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                    {scenarioTodayLeft !== null && (
                                                        <div
                                                            className="scenario-today"
                                                            style={{
                                                                left: `${scenarioTodayLeft}px`,
                                                                height: `calc(${scenarioLaneMeta.totalHeight}px + var(--scenario-axis-height))`
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                                <div
                                                    className="scenario-lanes"
                                                    style={{ height: `${scenarioLaneMeta.totalHeight}px` }}
                                                >
                                                    {scenarioLayout.width > 0 && scenarioQuarterMarkers.map((marker, index) => {
                                                        const left = scenarioLayout.labelWidth + scenarioLayout.width * marker.ratio;
                                                        return (
                                                            <div
                                                                key={`quarter-${index}-${marker.date.toISOString()}`}
                                                                className="scenario-quarter-line"
                                                                style={{ left: `${left}px` }}
                                                            />
                                                        );
                                                    })}
                                                    {scenarioVisibleLanes.map((lane) => {
                                                        const laneMeta = scenarioLaneMeta.meta.get(lane) || { height: SCENARIO_LANE_HEIGHT };
                                                        const laneHeight = laneMeta.height;
                                                        const allLaneIssues = scenarioIssuesByLane.get(lane) || [];
                                                        const laneIssues = scenarioShowConflictsOnly
                                                            ? allLaneIssues.filter(issue => scenarioAssigneeConflicts.conflicts.has(issue.key))
                                                            : allLaneIssues;
                                                        const laneEpicBars = scenarioEpicBars.filter(bar => bar.lane === lane);
                                                        const laneInfo = scenarioLaneInfo.get(lane) || { label: lane, key: lane };
                                                        const isCollapsed = laneMeta.collapsed;
                                                        return (
                                                        <div
                                                            key={lane}
                                                            className="scenario-lane"
                                                            style={{ top: `${laneMeta.offset}px` }}
                                                        >
                                                            <div className="scenario-lane-label-container" style={{ height: `${laneHeight}px` }}>
                                                            <button
                                                                className="scenario-lane-label"
                                                                type="button"
                                                                disabled={scenarioEpicFocus}
                                                                onClick={() => !scenarioEpicFocus && toggleScenarioLane(lane)}
                                                                aria-expanded={!isCollapsed}
                                                            >
                                                                <div className="scenario-lane-title">
                                                                    <span className="scenario-lane-title-text">
                                                                        {normalizeScenarioSummary(laneInfo.label) || laneInfo.label}
                                                                    </span>
                                                                    {scenarioLaneMode !== 'epic' && laneInfo.key && laneInfo.key !== laneInfo.label && (
                                                                        <span className="scenario-lane-key">{laneInfo.key}</span>
                                                                    )}
                                                                </div>
                                                                <div className="scenario-lane-meta">
                                                                    {Number.isFinite(laneInfo.totalSp) && laneInfo.totalSp > 0 && (
                                                                        <div className="scenario-lane-sp">Allocated: {laneInfo.totalSp.toFixed(1)} SP.</div>
                                                                    )}
                                                                    {scenarioLaneMode === 'team' && laneInfo.capacity != null && (
                                                                        <div className="scenario-lane-capacity">Team Size: {laneInfo.capacity + 1} 👥</div>
                                                                    )}
                                                                    {scenarioLaneMode === 'team' && (
                                                                        <div className={`scenario-lane-status ${(laneInfo.lateCount || laneInfo.unschedulableCount) ? 'risk' : 'ok'}`}>
                                                                            Status: {(laneInfo.lateCount || laneInfo.unschedulableCount) ? 'At risk' : 'OK'}
                                                                        </div>
                                                                    )}
                                                                    {laneInfo.conflictCount > 0 && (
                                                                        <div className="scenario-lane-conflicts">
                                                                            ⚠️ {laneInfo.conflictCount} conflict{laneInfo.conflictCount !== 1 ? 's' : ''}
                                                                        </div>
                                                                    )}
                                                                    {laneMeta.hiddenCount > 0 && (
                                                                        <div className="scenario-lane-more">+{laneMeta.hiddenCount} more</div>
                                                                    )}
                                                                </div>
                                                            </button>
                                                            {scenarioLaneMode === 'team' && (() => {
                                                                const groups = scenarioLaneAssigneeGroups.get(lane) || [];
                                                                return groups.map((group, idx) => {
                                                                    const displayName = group.assignee ? (() => { const parts = group.assignee.split(' '); return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]; })() : 'Unassigned';
                                                                    const top = scenarioBarGap + group.startRow * (SCENARIO_BAR_HEIGHT + scenarioBarGap);
                                                                    const height = group.rowCount * (SCENARIO_BAR_HEIGHT + scenarioBarGap);
                                                                    return (
                                                                        <div key={`al-${idx}`} className="scenario-assignee-label"
                                                                             style={{ top: `${top}px`, height: `${height}px` }}
                                                                             title={group.assignee || 'Unassigned'}>
                                                                            {displayName}
                                                                        </div>
                                                                    );
                                                                });
                                                            })()}
                                                            </div>
                                                            <div className="scenario-lane-track" style={{ height: `${laneHeight}px` }}>
                                                                {scenarioLaneMode === 'team' && (() => {
                                                                    const groups = scenarioLaneAssigneeGroups.get(lane) || [];
                                                                    return groups.slice(1).map((group, idx) => {
                                                                        const dividerY = group.startRow * (SCENARIO_BAR_HEIGHT + scenarioBarGap);
                                                                        return (
                                                                            <div key={`assignee-div-${idx}`} className="scenario-assignee-divider"
                                                                                 style={{ top: `${dividerY}px` }} />
                                                                        );
                                                                    });
                                                                })()}
                                                                {laneEpicBars.map(bar => {
                                                                    const left = `${(bar.xStart / scenarioLayout.width) * 100}%`;
                                                                    const width = `${Math.max(2, ((bar.xEnd - bar.xStart) / scenarioLayout.width) * 100)}%`;
                                                                    const top = `${Math.max(2, bar.y - (scenarioLaneMeta.meta.get(lane)?.offset || 0))}px`;
                                                                    const height = `${Math.max(10, bar.height)}px`;
                                                                    const epicAssignees = bar.assignees && bar.assignees.length > 0
                                                                        ? (bar.assignees.length === 1
                                                                            ? bar.assignees[0]
                                                                            : `${bar.assignees.length} assignees: ${bar.assignees.slice(0, 3).join(', ')}${bar.assignees.length > 3 ? '...' : ''}`)
                                                                        : null;
                                                                    const epicTooltip = buildScenarioTooltipPayload(
                                                                        bar.epicSummary || bar.epicKey,
                                                                        bar.epicKey,
                                                                        bar.storyPoints,
                                                                        bar.isExcluded,
                                                                        false, // hasConflict
                                                                        epicAssignees,
                                                                        [], // conflictingKeys
                                                                        false, // isOutOfSprint
                                                                        false // isInProgress
                                                                    );
                                                                    return (
                                                                        <div
                                                                            key={`${bar.lane}-${bar.epicKey}`}
                                                                            className={`scenario-epic-bar ${bar.isExcluded ? 'excluded' : ''}`}
                                                                            style={{ left, width, top, height }}
                                                                            role="button"
                                                                            tabIndex={0}
                                                                            onClick={() => focusScenarioEpic(bar.epicKey, bar.epicSummary)}
                                                                            onKeyDown={(event) => {
                                                                                if (event.key === 'Enter' || event.key === ' ') {
                                                                                    event.preventDefault();
                                                                                    focusScenarioEpic(bar.epicKey, bar.epicSummary);
                                                                                }
                                                                            }}
                                                                            onMouseEnter={(event) => showScenarioTooltip(event, epicTooltip)}
                                                                            onMouseMove={moveScenarioTooltip}
                                                                            onMouseLeave={hideScenarioTooltip}
                                                                            onFocus={(event) => showScenarioTooltipFromElement(event.currentTarget, epicTooltip)}
                                                                            onBlur={hideScenarioTooltip}
                                                                        >
                                                                        </div>
                                                                    );
                                                                })}
                                                                {laneIssues.map((issue) => {
                                                                    const position = scenarioPositions[issue.key];
                                                                    if (!position || !scenarioLayout.width) return null;
                                                                    const left = `${(position.xStart / scenarioLayout.width) * 100}%`;
                                                                    const width = `${Math.max(2, ((position.xEnd - position.xStart) / scenarioLayout.width) * 100)}%`;
                                                                    const top = `${position.y - (scenarioLaneMeta.meta.get(lane)?.offset || 0)}px`;
                                                                    const displayKey = issue.originalKey || issue.key;
                                                                    const issueUrl = scenarioBaseUrl ? `${scenarioBaseUrl}/browse/${displayKey}` : '';
                                                                    const issueSummary = normalizeScenarioSummary(issue.summary) || displayKey;
                                                                    const isExcluded = excludedEpicSet.has(normalizeEpicKey(issue.epicKey || ''));
                                                                    const hasAssigneeConflict = scenarioAssigneeConflicts.conflicts.has(displayKey);
                                                                    const conflictingKeys = scenarioAssigneeConflicts.conflictDetails.get(displayKey) || [];
                                                                    const issueEndDate = issue.end ? parseScenarioDate(issue.end) : null;
                                                                    const isOutOfSprint = issueEndDate && scenarioViewEnd && issueEndDate > scenarioViewEnd;
                                                                    const isInProgress = issue.progressPct !== null && issue.progressPct !== undefined;
                                                                    const issueTooltip = buildScenarioTooltipPayload(issue.summary || displayKey, displayKey, issue.sp, isExcluded, hasAssigneeConflict, issue.assignee, conflictingKeys, isOutOfSprint, isInProgress, issue.team);
                                                                    const isFocused = scenarioHoverKey === issue.key || scenarioFlashKey === issue.key;
                                                                    const isUpstream = scenarioUpstreamSet.has(issue.key);
                                                                    const isDownstream = scenarioDownstreamSet.has(issue.key);
                                                                    const isDimmed = scenarioHoverKey && !isFocused && !isUpstream && !isDownstream;
                                                                    const isUnscheduled = !issue.start || !issue.end;
                                                                    const isFocusContext = scenarioEpicFocus && scenarioFocusContextKeys.has(issue.key) && !scenarioFocusIssueKeys.has(issue.key);
                                                                    const isSearchMatch = scenarioSearchQuery && scenarioSearchMatchSet.has(issue.key);
                                                                    const isDone = issue.scheduledReason === 'already_done';
                                                                    const isIncomplete = issue.scheduledReason === 'incomplete';
                                                                    const incompleteProgress = isIncomplete ? (() => {
                                                                        const timeSpent = issue.timeSpentSeconds || 0;
                                                                        const sp = Number(issue.sp) || 0;
                                                                        if (timeSpent > 0 && sp > 0) {
                                                                            const spWeeks = sp * 2; // sp_to_weeks = 2.0
                                                                            const spSeconds = spWeeks * 5 * 8 * 3600; // weeks * days/week * hours/day * seconds/hour
                                                                            const ratio = Math.min(0.95, Math.max(0.05, timeSpent / spSeconds));
                                                                            return `${(ratio * 100).toFixed(0)}%`;
                                                                        }
                                                                        return '50%'; // fallback
                                                                    })() : null;
                                                                    const isEditable = scenarioEditMode && !isExcluded && Number(issue.sp) > 0 && !isUnscheduled;
                                                                    const isDragging = scenarioDragState?.issueKey === issue.key;
                                                                    const hasDepViolation = scenarioDepViolatedKeys.has(issue.key);
                                                                    const barClassName = `scenario-bar ${isDone ? 'done' : ''} ${isIncomplete ? 'incomplete' : ''} ${issue.isCritical ? 'critical' : ''} ${issue.isLate ? 'late' : ''} ${((issue.blockedBy || []).length > 0 || scenarioBlockedSet.has(issue.key)) ? 'blocked' : ''} ${(issue.isContext || isFocusContext) ? 'context' : ''} ${isUnscheduled ? 'unscheduled' : ''} ${isFocused ? 'is-focused' : ''} ${isUpstream ? 'is-upstream' : ''} ${isDownstream ? 'is-downstream' : ''} ${isDimmed ? 'dimmed' : ''} ${scenarioFlashKey === issue.key ? 'flash' : ''} ${isExcluded ? 'excluded' : ''} ${isSearchMatch ? 'search-match' : ''} ${hasAssigneeConflict ? 'assignee-conflict' : ''} ${isOutOfSprint ? 'out-of-sprint' : ''} ${isInProgress ? 'in-progress' : ''} ${isEditable ? 'editable' : ''} ${isDragging ? 'dragging' : ''} ${hasDepViolation ? 'dep-violated' : ''}`;
                                                                    const barStyle = isIncomplete && incompleteProgress
                                                                        ? { left, width, height: `${SCENARIO_BAR_HEIGHT}px`, top, '--incomplete-progress': incompleteProgress }
                                                                        : { left, width, height: `${SCENARIO_BAR_HEIGHT}px`, top };
                                                                    return (
                                                                        <ScenarioBar
                                                                            key={issue.key}
                                                                            issueKey={issue.key}
                                                                            className={barClassName}
                                                                            style={barStyle}
                                                                            href={issueUrl || '#'}
                                                                            displaySummary={issueSummary}
                                                                            dateSource={issue.dateSource}
                                                                            registerRef={registerScenarioIssueRef(issue.key)}
                                                                            onMouseDown={isEditable ? (e) => handleScenarioBarMouseDown(e, issue) : undefined}
                                                                            onClick={(event) => {
                                                                                event.preventDefault();
                                                                                if (scenarioWasDraggedRef.current) { scenarioWasDraggedRef.current = false; return; }
                                                                                const taskElement = document.querySelector(`[data-task-key="${issue.key}"]`);
                                                                                if (taskElement) {
                                                                                    const elementTop = taskElement.getBoundingClientRect().top + window.scrollY;
                                                                                    window.scrollTo({ top: elementTop - 100, behavior: 'smooth' });
                                                                                    taskElement.classList.add('is-focused');
                                                                                    setTimeout(() => {
                                                                                        taskElement.classList.remove('is-focused');
                                                                                    }, 1400);
                                                                                }
                                                                            }}
                                                                            onMouseEnter={(event) => {
                                                                                setScenarioHoverKey(issue.key);
                                                                                showScenarioTooltip(event, issueTooltip);
                                                                            }}
                                                                            onMouseMove={moveScenarioTooltip}
                                                                            onMouseLeave={() => {
                                                                                setScenarioHoverKey(null);
                                                                                hideScenarioTooltip();
                                                                            }}
                                                                            onFocus={(event) => {
                                                                                setScenarioHoverKey(issue.key);
                                                                                showScenarioTooltipFromElement(event.currentTarget, issueTooltip);
                                                                            }}
                                                                            onBlur={() => {
                                                                                setScenarioHoverKey(null);
                                                                                hideScenarioTooltip();
                                                                            }}
                                                                        />
                                                                    );
                                                                })}
                                                                {scenarioDragState && scenarioDragState.issueKey && scenarioViewStart && scenarioViewEnd && (() => {
                                                                    // Render ghost bar in the lane that contains the dragged issue
                                                                    const dragPosition = scenarioPositions[scenarioDragState.issueKey];
                                                                    if (!dragPosition || dragPosition.lane !== lane) return null;
                                                                    const ghostLeft = dateToPx(scenarioDragState.currentStart, scenarioLayout.width, scenarioViewStart, scenarioViewEnd);
                                                                    const ghostRight = dateToPx(scenarioDragState.currentEnd, scenarioLayout.width, scenarioViewStart, scenarioViewEnd);
                                                                    const ghostWidth = Math.max(6, ghostRight - ghostLeft);
                                                                    const laneMeta = scenarioLaneMeta.meta.get(lane);
                                                                    const laneOffset = laneMeta?.offset || 0;
                                                                    const ghostTop = dragPosition.y - laneOffset;
                                                                    return (
                                                                        <div
                                                                            className="scenario-drag-ghost"
                                                                            style={{
                                                                                left: `${ghostLeft}px`,
                                                                                width: `${ghostWidth}px`,
                                                                                top: `${ghostTop}px`,
                                                                                height: `${SCENARIO_BAR_HEIGHT}px`,
                                                                                borderRadius: '4px',
                                                                            }}
                                                                        />
                                                                    );
                                                                })()}
                                                            </div>
                                                        </div>
                                                    )})}
                                                </div>
                                                {scenarioEdgeRender.width > 0 && (
                                                    <svg
                                                        className="scenario-deps"
                                                        viewBox={`0 0 ${scenarioEdgeRender.width} ${scenarioEdgeRender.height}`}
                                                        preserveAspectRatio="none"
                                                        style={{ height: `${scenarioEdgeRender.height}px`, width: `${scenarioEdgeRender.width}px` }}
                                                    >
                                                        <defs>
                                                            <marker id="scenario-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                                                <path d="M0,0 L6,3 L0,6 z" fill="#94a3b8" />
                                                            </marker>
                                                            <marker id="scenario-arrow-block" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                                                <path d="M0,0 L6,3 L0,6 z" fill="#ef4444" />
                                                            </marker>
                                                            <marker id="scenario-arrow-violated" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                                                <path d="M0,0 L6,3 L0,6 z" fill="#ef4444" />
                                                            </marker>
                                                        </defs>
                                                        {scenarioLaneMode === 'epic' && scenarioEpicEdges.map((edge, index) => (
                                                            <g key={`epic-edge-${edge.fromEpic}-${edge.toEpic}-${index}`}>
                                                                <path
                                                                    className="scenario-epic-edge"
                                                                    d={`M 8 ${edge.y1} L 8 ${edge.y2}`}
                                                                />
                                                                <text className="scenario-epic-edge-label" x="12" y={(edge.y1 + edge.y2) / 2}>
                                                                    {edge.count}
                                                                </text>
                                                            </g>
                                                        ))}
                                                        {scenarioEdgeRender.paths.map((path) => {
                                                            const isViolated = scenarioDepViolations.has(`${path.from}->${path.to}`);
                                                            return (
                                                                <path
                                                                    key={path.id}
                                                                    className={`scenario-edge ${path.isActive ? 'active' : ''} ${path.isFaded ? 'faded' : ''} ${path.isContextEdge ? 'context' : ''} ${path.type === 'block' ? 'block' : ''} ${isViolated ? 'violated' : ''}`}
                                                                    d={path.d}
                                                                    markerEnd={path.type === 'block' ? 'url(#scenario-arrow-block)' : (isViolated ? 'url(#scenario-arrow-violated)' : 'url(#scenario-arrow)')}
                                                                />
                                                            );
                                                        })}
                                                    </svg>
                                                )}
                                                <div
                                                    className={`scenario-tooltip ${scenarioTooltip.visible ? 'visible' : ''}`}
                                                    style={{ left: `${scenarioTooltip.x}px`, top: `${scenarioTooltip.y}px` }}
                                                    ref={scenarioTooltipRef}
                                                >
                                                    <div>{scenarioTooltip.summary}</div>
                                                    {scenarioTooltip.key && <div className="scenario-tooltip-key">{scenarioTooltip.key}</div>}
                                                    {scenarioTooltip.assignee && (
                                                        <div className="scenario-tooltip-key">👤 {scenarioTooltip.assignee}</div>
                                                    )}
                                                    {scenarioTooltip.team && (
                                                        <div className="scenario-tooltip-key">👥 {scenarioTooltip.team}</div>
                                                    )}
                                                    {Number.isFinite(scenarioTooltip.sp) && (
                                                        <div className="scenario-tooltip-key">SP: {scenarioTooltip.sp.toFixed(1)}</div>
                                                    )}
                                                    {scenarioTooltip.note && (
                                                        <div className="scenario-tooltip-note">{scenarioTooltip.note}</div>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {selectedView === 'eng' && showPlanning && (
                    <div ref={planningPanelRef} className={`planning-panel ${showPlanning ? 'open' : ''}${isPlanningStuck ? ' stuck' : ''}`}>
                        {/* --- Planning Actions (top of panel) --- */}
                        <div className="planning-actions">
                            <button
                                className={`planning-action-button ${isAcceptedIncluded ? 'active' : ''}`}
                                onClick={() => toggleIncludeByStatus(['Accepted', 'In Progress'])}
                                disabled={visibleTasks.length === 0}
                                title="Include all Accepted and In Progress stories for the current view"
                            >
                                Accepted
                            </button>
                            <button
                                className={`planning-action-button ${isTodoIncluded ? 'active' : ''}`}
                                onClick={() => toggleIncludeByStatus(['To Do', 'Pending'])}
                                disabled={visibleTasks.length === 0}
                                title="Include all To Do / Pending stories for the current view"
                            >
                                To Do
                            </button>
                            <button
                                className={`planning-action-button ${isPostponedIncluded ? 'active' : ''}`}
                                onClick={() => toggleIncludeByStatus(['Postponed'])}
                                disabled={planningPostponedTasks.length === 0}
                                title="Include all Postponed stories for the current view"
                            >
                                Postponed
                            </button>
                            <button
                                className={`planning-action-button ${isAwaitingValidationIncluded ? 'active' : ''}`}
                                onClick={() => toggleIncludeByStatus(['Awaiting Validation'])}
                                disabled={planningAwaitingValidationTasks.length === 0}
                                title="Include all Awaiting Validation stories for the current view"
                            >
                                Awaiting Val.
                            </button>
                            <button
                                className={`planning-action-button ${areAllVisiblePlanningTasksSelected ? 'active' : ''}`}
                                onClick={selectAllVisiblePlanningTasks}
                                disabled={visibleTasksForList.length === 0}
                                title="Select every task currently visible in the planning list"
                            >
                                Select All
                            </button>
                            <button
                                className="uncheck-button"
                                onClick={clearSelectedTasks}
                                disabled={selectedCount === 0}
                                title="Clear all selected tasks"
                            >
                                Clear Selected
                            </button>
                            <button
                                className="planning-action-button planning-icon-button"
                                onClick={openSelectedInJira}
                                disabled={selectedCount === 0 || !jiraUrl}
                                title="Open selected stories in Jira (tip: bulk move them to Accepted)"
                                aria-label="Open selected stories in Jira"
                            >
                                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                    <path d="M10 2h4v4h-1.5V4.56L8.53 8.53l-1.06-1.06L11.44 3.5H10V2z" />
                                    <path d="M13 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4v1.5H3.5v8h8V9H13z" />
                                </svg>
                            </button>
                        </div>
                        {/* --- Capacity Bar Graph --- */}
                        {capacityEnabled && totalCapacityAdjusted > 0 ? (() => {
                            const scale = Math.max(totalCapacityAdjusted, selectedSP) * 1.15;
                            const toPct = (v) => Math.min(100, (v / scale) * 100);
                            const selectedPct = toPct(selectedSP);
                            const planningPct = toPct(estimatedCapacityAdjusted);
                            const teamCapPct = toPct(totalCapacityAdjusted);
                            const showPlanningMarker = Math.abs(estimatedCapacityAdjusted - totalCapacityAdjusted) > 0.05;
                            const isOver = capacitySummary.status === 'over';
                            const isUnder = capacitySummary.status === 'under';
                            const varianceOverPct = isOver ? selectedPct - teamCapPct : 0;
                            return (
                                <div className="capacity-bar-graph">
                                    <div className="capacity-bar-track">
                                        {/* Excluded zone */}
                                        {excludedCapacityAdjusted > 0 && (
                                            <div className="capacity-bar-excluded-zone" style={{ left: `${planningPct}%`, width: `${teamCapPct - planningPct}%` }} />
                                        )}
                                        {/* Variance overshoot zone (always visible when over) */}
                                        {varianceOverPct > 0 && (
                                            <div className="capacity-bar-variance-zone visible" style={{ left: `${teamCapPct}%`, width: `${varianceOverPct}%` }} />
                                        )}
                                        {/* Under-capacity gap zone (visible when under) */}
                                        {isUnder && (
                                            <div className="capacity-bar-variance-zone under-zone" style={{ left: `${selectedPct}%`, width: `${teamCapPct - selectedPct}%` }} />
                                        )}
                                        {/* Selected fill — clip at teamCap when over so variance zone is visible */}
                                        <div className={`capacity-bar-fill ${isOver ? 'over' : isUnder ? 'under' : ''}${(isOver ? teamCapPct : selectedPct) < 20 ? ' narrow' : ''}`} style={{ width: `${isOver ? teamCapPct : selectedPct}%` }} data-tooltip={`Total story points from ${selectedCount} selected tasks.`}>
                                            <span className="capacity-bar-fill-label">{selectedCount} tasks · {selectedSP.toFixed(1)} SP</span>
                                        </div>
                                        {/* Planning marker */}
                                        {showPlanningMarker && (
                                            <div className="capacity-bar-marker planning" style={{ left: `${planningPct}%` }} data-tooltip="Team capacity minus excluded mandatory activities (perf review, dev lead management, etc.).">
                                                <div className="capacity-bar-marker-line dashed" />
                                                <div className="capacity-bar-marker-label">Planning<br/>{estimatedCapacityAdjusted.toFixed(1)}</div>
                                            </div>
                                        )}
                                        {/* Team cap marker */}
                                        <div className="capacity-bar-marker teamcap" style={{ left: `${teamCapPct}%` }} data-tooltip="Estimated total team capacity for the quarter.">
                                            <div className="capacity-bar-marker-line" />
                                            <div className="capacity-bar-marker-label">Team Cap<br/>{totalCapacityAdjusted.toFixed(1)}</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })() : (
                            <div className="planning-stats">
                                <div className="planning-stat">
                                    <span className="planning-stat-label">Selected:</span>
                                    <span className="planning-stat-value">{selectedCount} · {selectedSP.toFixed(1)} SP</span>
                                </div>
                            </div>
                        )}

                        {/* --- Team MicroBar tiles --- */}
                        {selectedTeamEntries.length > 0 && (() => {
                            const sortedTeams = [...selectedTeamEntries].sort((a, b) => {
                                if (capacityEnabled) {
                                    const da = a.storyPoints - (a.teamCapacity || 0);
                                    const db = b.storyPoints - (b.teamCapacity || 0);
                                    if (db !== da) return db - da;
                                }
                                return b.storyPoints - a.storyPoints;
                            });
                            const teamCount = sortedTeams.length;
                            const maxPerRow = 6;
                            const rows = teamCount === 6 ? 2 : Math.ceil(teamCount / maxPerRow);
                            const cols = Math.ceil(teamCount / rows);
                            return (
                                <>
                                    <div className="planning-stats compact" style={{ marginTop: '0.4rem' }}>
                                        <div className="planning-stat">
                                            <span className="planning-stat-label">Selected SP by Team:</span>
                                        </div>
                                    </div>
                                    <div className="team-stats-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                                        {sortedTeams.map((info) => {
                                            const capMeta = capacityEnabled && info.teamCapacity > 0 ? getTeamCapacityMeta(info.storyPoints, info.teamCapacity) : null;
                                            const teamColor = resolveTeamColor(info.id);
                                            const barW = 116;
                                            const barH = 14;
                                            const hasCap = capacityEnabled && info.teamCapacity > 0;
                                            const scale = hasCap ? info.teamCapacity * 1.3 : info.storyPoints * 1.3;
                                            const valW = scale > 0 ? Math.min(barW, (info.storyPoints / scale) * barW) : 0;
                                            const markerX = hasCap ? (info.teamCapacity / scale) * barW : null;
                                            const deltaSp = hasCap ? info.storyPoints - info.teamCapacity : null;
                                            const deltaPct = hasCap ? ((info.storyPoints / info.teamCapacity) - 1) * 100 : null;
                                            const tooltipText = hasCap
                                                ? `${deltaSp >= 0 ? '+' : ''}${deltaSp.toFixed(1)} SP (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%)`
                                                : `${info.storyPoints.toFixed(1)} SP selected`;
                                            const spLabel = `${info.storyPoints.toFixed(1)} SP`;
                                            const deltaLabel = hasCap
                                                ? `Cap ${info.teamCapacity.toFixed(1)} · ${deltaSp >= 0 ? '+' : ''}${deltaSp.toFixed(1)} SP · ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%`
                                                : null;
                                            return (
                                                <div key={info.id} className="team-stat-card team-card" data-tooltip={tooltipText}>
                                                    <div className="team-stat-label">{info.name}</div>
                                                    <div className="microbar">
                                                        <div className="microbar-fill" style={{width: `${scale > 0 ? Math.min(100, (valW / barW) * 100) : 0}%`, background: teamColor}} />
                                                        {markerX !== null && (
                                                            <div className="microbar-marker" style={{left: `${(markerX / barW) * 100}%`}} />
                                                        )}
                                                        <span className="microbar-label">{spLabel}</span>
                                                    </div>
                                                    {deltaLabel && (
                                                        <div className={`microbar-meta ${capMeta && capMeta.status ? capMeta.status : ''}`}>{deltaLabel}</div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            );
                        })()}

                        {/* --- Project Split Bar --- */}
                        <div className="planning-stats compact" style={{ marginTop: '0.35rem' }}>
                            <div className="planning-stat">
                                <span className="planning-stat-label" data-tooltip="Planning capacity split: 70% Product / 30% Tech (tech-heavy teams may aim for 10% / 90%). Selected effort excludes excluded epics.">Selected SP by Project:</span>
                            </div>
                        </div>
                        {(() => {
                            const projectTotal = selectedProjectEntries.reduce((sum, e) => sum + e.storyPoints, 0);
                            const productEntry = selectedProjectEntries.find(e => e.id === 'PRODUCT');
                            const techEntry = selectedProjectEntries.find(e => e.id === 'TECH');
                            const productSP = productEntry ? productEntry.storyPoints : 0;
                            const techSP = techEntry ? techEntry.storyPoints : 0;
                            const productPct = projectTotal > 0 ? (productSP / projectTotal) * 100 : 0;
                            const techPct = projectTotal > 0 ? (techSP / projectTotal) * 100 : 0;
                            const excludedProduct = excludedProjectStats['PRODUCT'] || 0;
                            const excludedTech = excludedProjectStats['TECH'] || 0;
                            const excludedTotal = excludedProduct + excludedTech;
                            const targetPct = 70;
                            if (projectTotal === 0 && excludedTotal === 0) {
                                return (
                                    <div className="planning-stat" style={{ marginTop: '0.3rem' }}>
                                        <span className="planning-stat-value">No tasks selected</span>
                                    </div>
                                );
                            }
                            return (
                                <div className="project-bar-graph">
                                    <div className="capacity-bar-track">
                                        {/* Product fill */}
                                        <div
                                            className="project-bar-fill product"
                                            style={{ width: `${productPct}%`, borderRadius: techPct > 0 ? '6px 0 0 6px' : '6px' }}
                                            data-tooltip={`Product: ${productSP.toFixed(1)} SP (${productPct.toFixed(0)}% of selected).${excludedProduct > 0 ? ` Excluded: ${excludedProduct.toFixed(1)} SP.` : ''}`}
                                        >
                                            {productPct > 15 && (
                                                <span className="capacity-bar-fill-label">Product {productPct.toFixed(0)}% · {productSP.toFixed(1)} SP</span>
                                            )}
                                        </div>
                                        {/* Tech fill */}
                                        {techPct > 0 && (
                                        <div
                                            className="project-bar-fill tech"
                                            style={{ left: `${productPct}%`, width: `${techPct}%` }}
                                            data-tooltip={`Tech: ${techSP.toFixed(1)} SP (${techPct.toFixed(0)}% of selected).${excludedTech > 0 ? ` Excluded: ${excludedTech.toFixed(1)} SP.` : ''}`}
                                        >
                                            {techPct > 15 && (
                                                <span className="capacity-bar-fill-label">Tech {techPct.toFixed(0)}% · {techSP.toFixed(1)} SP</span>
                                            )}
                                        </div>
                                        )}
                                        {/* 70% target marker */}
                                        <div className="capacity-bar-marker" style={{ left: `${targetPct}%` }}>
                                            <div className="capacity-bar-marker-line dashed" />
                                            <div className="capacity-bar-marker-label">Target<br/>{targetPct}% / {100 - targetPct}%</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                    )}
                    {!isLeadTimesFocusMode && (
                        <>
                            {shouldRenderEngTaskList && showBackToTop && (
                                <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                                    Back to top
                                </button>
                            )}

                            {shouldRenderEngTaskList && (
                                <EngView
                                    selectedView={selectedView}
                                    productTasksLoading={productTasksLoading}
                                    techTasksLoading={techTasksLoading}
                                    loading={loading}
                                    error={error}
                                    onRetry={fetchTasks}
                                    alertCelebrationPieces={alertCelebrationPieces}
                                    alertsPanel={(
                                        <EngAlertsPanel
                                            selectedView={selectedView}
                                            alertItemCount={alertItemCount}
                                            showAlertsPanel={showAlertsPanel}
                                            setShowAlertsPanel={setShowAlertsPanel}
                                            collapsed={!showMissingAlert && !showBlockedAlert && !showPostponedAlert && !showBacklogAlert && !showMissingTeamAlert && !showMissingLabelsAlert && !showNeedsStoriesAlert && !showWaitingAlert && !showEmptyEpicAlert && !showDoneEpicAlert}
                                            alertProps={{
                                                analysisEpicTeams,
                                                backlogEpicTeams,
                                                backlogEpics,
                                                blockedAlertTeams,
                                                blockedTasks,
                                                buildKeyListLink,
                                                buildTeamStatusLink,
                                                consolidatedMissingStories,
                                                dismissAlertItem,
                                                doneEpicTeams,
                                                doneStoryEpics,
                                                emptyEpicTeams,
                                                emptyEpics,
                                                emptyEpicsForAlert,
                                                futureRoutedEpics,
                                                getBlockedAlertStatusLabel,
                                                getFuturePlanningNeedsStoriesReasonText,
                                                handleAlertStoryClick,
                                                isFutureSprintSelected,
                                                jiraUrl,
                                                missingAlertTeams,
                                                missingLabelEpicTeams,
                                                missingLabelEpics,
                                                missingTeamEpicTeams,
                                                missingTeamEpics,
                                                needsStoriesEntries,
                                                needsStoriesTeams,
                                                postponedAlertTeams,
                                                postponedEpicTeams,
                                                postponedTasks,
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
                                                waitingForStoriesEpics,
                                            }}
                                        />
                                    )}
                                    statusFilter={statusFilter}
                                    setStatusFilter={setStatusFilter}
                                    baseFilteredTasks={baseFilteredTasks}
                                    totalStoryPoints={totalStoryPoints}
                                    doneTasksCount={doneTasksCount}
                                    doneStoryPoints={doneStoryPoints}
                                    highPriorityCount={highPriorityCount}
                                    highPriorityStoryPoints={highPriorityStoryPoints}
                                    minorPriorityCount={minorPriorityCount}
                                    minorPriorityStoryPoints={minorPriorityStoryPoints}
                                    inProgressTasksCount={inProgressTasksCount}
                                    inProgressStoryPoints={inProgressStoryPoints}
                                    todoAcceptedTasksCount={todoAcceptedTasksCount}
                                    todoAcceptedStoryPoints={todoAcceptedStoryPoints}
                                    showTech={showTech}
                                    setShowTech={setShowTech}
                                    techTasksCount={techTasksCount}
                                    showProduct={showProduct}
                                    setShowProduct={setShowProduct}
                                    productTasksCount={productTasksCount}
                                    doneTasks={doneTasks}
                                    incompleteTasks={incompleteTasks}
                                    showDone={showDone}
                                    setShowDone={setShowDone}
                                    killedTasks={killedTasks}
                                    showKilled={showKilled}
                                    hasInitiativeData={hasInitiativeData}
                                    groupByInitiative={groupByInitiative}
                                    setGroupByInitiative={setGroupByInitiative}
                                    InitiativeIcon={InitiativeIcon}
                                    visibleTasksForList={visibleTasksForList}
                                    activeDependencyFocus={activeDependencyFocus}
                                    handleDependencyFocusClick={handleDependencyFocusClick}
                                    initiativeGroups={initiativeGroups}
                                    epicGroups={epicGroups}
                                    renderEpicBlock={renderEpicBlock}
                                    jiraUrl={jiraUrl}
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
                        <SettingsModal
                            activeTab={activeSettingsModalTab}
                            tabs={settingsModalTabs}
                            isDirty={groupManageTab !== 'connections' && isGroupDraftDirty}
                            unsavedSectionsCount={groupManageTab !== 'connections' ? unsavedSectionsCount : 0}
                            onRequestClose={requestCloseGroupManage}
                            validationMessages={groupManageTab !== 'connections' ? groupConfigValidationErrors : []}
                            showTestConfiguration={groupManageTab !== 'epm' && groupManageTab !== 'connections'}
                            onTestConfiguration={testGroupsConfigConnection}
                            testConfigurationDisabled={groupTesting}
                            testConfigurationLabel={groupTesting ? 'Testing...' : 'Test configuration'}
                            testConfigurationMessage={groupTestMessage}
                            onCancel={requestCloseGroupManage}
                            cancelLabel={groupManageTab === 'connections' ? 'Close' : 'Cancel'}
                            onSave={settingsSaveHandler}
                            showSave={settingsShowsSave}
                            saveDisabled={settingsSaveDisabled}
                            saveTitle={settingsSaveTitle}
                            saveLabel={settingsSaveLabel}
                            showDiscardConfirm={showGroupDiscardConfirm}
                            onDiscard={discardGroupDraftChanges}
                            onKeepEditing={() => setShowGroupDiscardConfirm(false)}
                        >
                                {groupManageTab === 'connections' && (
                                <UserConnectionsSettings
                                    backendUrl={BACKEND_URL}
                                    onConnectionChange={handleHomeTokenConnectionChange}
                                />
                                )}
                                {ADMIN_SETTINGS_TAB_IDS.has(groupManageTab) && (
                                <>
                                <div
                                    className="group-modal-tabs epm-settings-tabs"
                                    role="tablist"
                                    aria-label="Admin settings sections"
                                    onKeyDown={handleAdminSettingsTabKeyDown}
                                >
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'scope' ? 'active' : ''}`}
                                        onClick={() => selectAdminSettingsTab('scope')}
                                        role="tab"
                                        aria-selected={groupManageTab === 'scope'}
                                        aria-controls="admin-settings-scope-panel"
                                        id="admin-settings-scope-tab"
                                        type="button"
                                    >Scope projects</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'source' ? 'active' : ''}`}
                                        onClick={() => selectAdminSettingsTab('source')}
                                        role="tab"
                                        aria-selected={groupManageTab === 'source'}
                                        aria-controls="admin-settings-source-panel"
                                        id="admin-settings-source-tab"
                                        type="button"
                                    >Jira source</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'mapping' ? 'active' : ''}`}
                                        onClick={() => selectAdminSettingsTab('mapping')}
                                        role="tab"
                                        aria-selected={groupManageTab === 'mapping'}
                                        aria-controls="admin-settings-mapping-panel"
                                        id="admin-settings-mapping-tab"
                                        type="button"
                                    >Field mapping</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'capacity' ? 'active' : ''}`}
                                        onClick={() => selectAdminSettingsTab('capacity')}
                                        role="tab"
                                        aria-selected={groupManageTab === 'capacity'}
                                        aria-controls="admin-settings-capacity-panel"
                                        id="admin-settings-capacity-tab"
                                        type="button"
                                    >Capacity</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'priorityWeights' ? 'active' : ''}`}
                                        onClick={() => selectAdminSettingsTab('priorityWeights')}
                                        role="tab"
                                        aria-selected={groupManageTab === 'priorityWeights'}
                                        aria-controls="admin-settings-priorityWeights-panel"
                                        id="admin-settings-priorityWeights-tab"
                                        type="button"
                                    >Priority weights</button>
                                </div>
                                <div
                                    id={`admin-settings-${groupManageTab}-panel`}
                                    role="tabpanel"
                                    aria-labelledby={`admin-settings-${groupManageTab}-tab`}
                                >
                                <JiraFieldSettings
                                    {...{
                                        groupManageTab,
                                        showTechnicalFieldIds,
                                        setShowTechnicalFieldIds,
                                        sprintFieldNameDraft,
                                        sprintFieldIdDraft,
                                        setSprintFieldIdDraft,
                                        setSprintFieldNameDraft,
                                        loadingFields,
                                        sprintFieldSearchQuery,
                                        setSprintFieldSearchQuery,
                                        setSprintFieldSearchOpen,
                                        setSprintFieldSearchIndex,
                                        handleSprintFieldSearchKeyDown,
                                        sprintFieldSearchInputRef,
                                        jiraFields,
                                        sprintFieldSearchOpen,
                                        sprintFieldSearchResults,
                                        sprintFieldSearchIndex,
                                        boardIdDraft,
                                        boardSearchRemoteLoading,
                                        boardSearchQuery,
                                        setBoardSearchQuery,
                                        setBoardSearchOpen,
                                        setBoardSearchIndex,
                                        handleBoardSearchKeyDown,
                                        boardSearchInputRef,
                                        boardSearchOpen,
                                        boardSearchResults,
                                        boardSearchIndex,
                                        setBoardIdDraft,
                                        setBoardNameDraft,
                                        boardNameDraft,
                                        clearBoardSelection,
                                        loadingProjects,
                                        jiraProjects,
                                        projectSearchQuery,
                                        setProjectSearchQuery,
                                        setProjectSearchOpen,
                                        setProjectSearchIndex,
                                        handleProjectSearchKeyDown,
                                        projectSearchInputRef,
                                        projectSearchOpen,
                                        projectSearchRemoteLoading,
                                        projectSearchResults,
                                        projectSearchIndex,
                                        addProjectSelection,
                                        selectedProjectsDraft,
                                        resolveProjectName,
                                        removeProjectSelection,
                                        mappingHoverKey,
                                        setMappingHoverKey,
                                        issueTypesDraft,
                                        parentNameFieldNameDraft,
                                        storyPointsFieldNameDraft,
                                        teamFieldNameDraft,
                                        parentNameFieldIdDraft,
                                        storyPointsFieldIdDraft,
                                        teamFieldIdDraft,
                                        issueTypeSearchQuery,
                                        setIssueTypeSearchQuery,
                                        setIssueTypeSearchOpen,
                                        setIssueTypeSearchIndex,
                                        handleIssueTypeSearchKeyDown,
                                        issueTypeSearchInputRef,
                                        issueTypeSearchOpen,
                                        issueTypeSearchResults,
                                        issueTypeSearchIndex,
                                        addIssueType,
                                        removeIssueType,
                                        setParentNameFieldIdDraft,
                                        setParentNameFieldNameDraft,
                                        parentNameFieldSearchQuery,
                                        setParentNameFieldSearchQuery,
                                        setParentNameFieldSearchOpen,
                                        setParentNameFieldSearchIndex,
                                        handleParentNameFieldSearchKeyDown,
                                        parentNameFieldSearchInputRef,
                                        parentNameFieldSearchOpen,
                                        parentNameFieldSearchResults,
                                        parentNameFieldSearchIndex,
                                        setStoryPointsFieldIdDraft,
                                        setStoryPointsFieldNameDraft,
                                        storyPointsFieldSearchQuery,
                                        setStoryPointsFieldSearchQuery,
                                        setStoryPointsFieldSearchOpen,
                                        setStoryPointsFieldSearchIndex,
                                        handleStoryPointsFieldSearchKeyDown,
                                        storyPointsFieldSearchInputRef,
                                        storyPointsFieldSearchOpen,
                                        storyPointsFieldSearchResults,
                                        storyPointsFieldSearchIndex,
                                        teamFieldSearchQuery,
                                        setTeamFieldSearchQuery,
                                        setTeamFieldSearchOpen,
                                        setTeamFieldSearchIndex,
                                        handleTeamFieldSearchKeyDown,
                                        teamFieldSearchInputRef,
                                        teamFieldSearchOpen,
                                        teamFieldSearchResults,
                                        teamFieldSearchIndex,
                                        setTeamFieldIdDraft,
                                        setTeamFieldNameDraft,
                                        capacityProjectDraft,
                                        resolveCapacityProjectName,
                                        setCapacityProjectDraft,
                                        capacityProjectSearchQuery,
                                        setCapacityProjectSearchQuery,
                                        setCapacityProjectSearchOpen,
                                        setCapacityProjectSearchIndex,
                                        handleCapacityProjectSearchKeyDown,
                                        capacityProjectSearchInputRef,
                                        capacityProjectSearchOpen,
                                        capacityProjectSearchResults,
                                        capacityProjectSearchIndex,
                                        capacityFieldNameDraft,
                                        capacityFieldIdDraft,
                                        setCapacityFieldIdDraft,
                                        setCapacityFieldNameDraft,
                                        capacityFieldSearchQuery,
                                        setCapacityFieldSearchQuery,
                                        setCapacityFieldSearchOpen,
                                        setCapacityFieldSearchIndex,
                                        handleCapacityFieldSearchKeyDown,
                                        capacityFieldSearchInputRef,
                                        capacityFieldSearchOpen,
                                        capacityFieldSearchResults,
                                        capacityFieldSearchIndex,
                                        priorityWeightsSource,
                                        priorityWeightsDraft,
                                        updatePriorityWeightDraft,
                                        priorityWeightsSum,
                                        resetPriorityWeightsDraft,
                                        priorityWeightsValidationError,
                                    }}
                                />
                                </div>
                                </>
                                )}
                                {groupManageTab === 'epm' && (
                                <EpmSettings
                                    {...{
                                        DEFAULT_EPM_LABEL_PREFIX,
                                        epmSettingsTab,
                                        setEpmSettingsTab,
                                        handleEpmSettingsTabKeyDown,
                                        epmScopeMeta,
                                        selectedEpmRootGoal,
                                        clearEpmRootGoal,
                                        epmRootGoalQuery,
                                        setEpmRootGoalQuery,
                                        setEpmRootGoalOpen,
                                        setEpmRootGoalIndex,
                                        handleEpmRootGoalSearchKeyDown,
                                        epmRootGoalsLoading,
                                        showEpmRootGoalResults,
                                        epmRootGoalsError,
                                        filteredEpmRootGoals,
                                        visibleEpmRootGoals,
                                        activeEpmRootGoalIndex,
                                        selectEpmRootGoal,
                                        selectedEpmSubGoals,
                                        clearEpmSubGoal,
                                        epmConfigDraft,
                                        epmSubGoalQuery,
                                        setEpmSubGoalQuery,
                                        setEpmSubGoalOpen,
                                        setEpmSubGoalIndex,
                                        loadEpmSubGoalsForRoot,
                                        handleEpmSubGoalSearchKeyDown,
                                        epmSubGoalsLoading,
                                        showEpmSubGoalResults,
                                        epmSubGoalsError,
                                        filteredEpmSubGoals,
                                        visibleEpmSubGoals,
                                        activeEpmSubGoalIndex,
                                        selectEpmSubGoal,
                                        updateEpmLabelPrefixDraft,
                                        epmProjectPrerequisites,
                                        canLoadEpmProjects,
                                        epmConfigLoading,
                                        epmConfigSaving,
                                        epmSettingsProjectsError,
                                        epmSettingsProjectsRefreshing,
                                        ensureEpmSettingsProjectsLoaded,
                                        epmSettingsProjectsLoadedAt,
                                        epmSettingsProjectsFetchMeta,
                                        epmSettingsProjectView,
                                        setEpmSettingsProjectView,
                                        focusEpmScopeField,
                                        addCustomEpmProjectDraft,
                                        epmSettingsProjectsLoading,
                                        renderEpmProjectSkeletonRows,
                                        epmSettingsProjectsLoaded,
                                        epmSettingsProjectRows,
                                        epmSettingsProjectSort,
                                        setEpmSettingsProjectSort,
                                        epmSettingsProjects,
                                        getEpmLabelRowKey,
                                        getEpmLabelSearchResults,
                                        labelSearchLoading,
                                        epmLabelShowAll,
                                        epmLabelChanging,
                                        labelSearchIndex,
                                        isEmptyCustomEpmProjectRow,
                                        setEpmLabelChanging,
                                        openEpmLabelMenu,
                                        loadEpmProjectLabels,
                                        updateEpmProjectDraft,
                                        labelSearchQuery,
                                        setLabelSearchQuery,
                                        setLabelSearchIndex,
                                        setLabelSearchOpen,
                                        setEpmLabelMenuAnchor,
                                        epmLabelMenuInputRef,
                                        handleEpmLabelSearchKeyDown,
                                        setEpmLabelShowAll,
                                        removeEpmProjectDraft,
                                        epmLabelMenuAnchor,
                                        labelSearchOpen,
                                        selectEpmProjectLabel,
                                    }}
                                />
                                )}
                                {DEPARTMENT_SETTINGS_TAB_IDS.has(groupManageTab) && (
                                <>
                                <div
                                    className="group-modal-tabs epm-settings-tabs"
                                    role="tablist"
                                    aria-label="Departments settings sections"
                                    onKeyDown={handleDepartmentSettingsTabKeyDown}
                                >
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'teams' ? 'active' : ''}`}
                                        onClick={() => selectDepartmentSettingsTab('teams')}
                                        role="tab"
                                        aria-selected={groupManageTab === 'teams'}
                                        aria-controls="department-settings-teams-panel"
                                        id="department-settings-teams-tab"
                                        type="button"
                                    >Team groups</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'labels' ? 'active' : ''}`}
                                        onClick={() => selectDepartmentSettingsTab('labels')}
                                        role="tab"
                                        aria-selected={groupManageTab === 'labels'}
                                        aria-controls="department-settings-labels-panel"
                                        id="department-settings-labels-tab"
                                        type="button"
                                        disabled={!labelsTabEnabled}
                                        title={labelsTabEnabled ? '' : 'Save at least one group first'}
                                    >Group labels</button>
                                </div>
                                {groupManageTab === 'teams' && (
                                <div
                                    id="department-settings-teams-panel"
                                    role="tabpanel"
                                    aria-labelledby="department-settings-teams-tab"
                                >
                                <TeamGroupsSettings
                                    {...{
                                        groupManageTab,
                                        showGroupListMobile,
                                        setShowGroupListMobile,
                                        addGroupDraftRow,
                                        groupSearchQuery,
                                        setGroupSearchQuery,
                                        filteredGroupDrafts,
                                        activeGroupDraft,
                                        groupDraft,
                                        setActiveGroupDraftId,
                                        groupsError,
                                        groupWarnings,
                                        groupDraftError,
                                        fetchAllTeamsFromJira,
                                        loadingTeams,
                                        teamCacheLabel,
                                        updateGroupDraftName,
                                        toggleDefaultGroupDraft,
                                        duplicateGroupDraft,
                                        resolveTeamName,
                                        removeTeamFromGroup,
                                        teamChipLastRef,
                                        availableTeams,
                                        activeTeamQuery,
                                        handleTeamSearchChange,
                                        handleTeamSearchFocus,
                                        handleTeamSearchBlur,
                                        handleTeamSearchKeyDown,
                                        activeTeamResultsLimited,
                                        teamSearchInputRefs,
                                        teamSearchOpen,
                                        activeTeamIndex,
                                        addTeamToGroup,
                                        teamSearchFeedback,
                                        componentSearchQuery,
                                        setComponentSearchQuery,
                                        setComponentSearchOpen,
                                        componentSearchOpen,
                                        componentSearchLoading,
                                        filteredComponentSearchResults,
                                        componentSearchIndex,
                                        handleComponentSearchKeyDown,
                                        addGroupMissingInfoComponent,
                                        removeGroupMissingInfoComponent,
                                        excludedEpicSearchQuery,
                                        handleExcludedEpicSearchChange,
                                        handleExcludedEpicSearchFocus,
                                        handleExcludedEpicSearchBlur,
                                        handleExcludedEpicSearchKeyDown,
                                        excludedEpicSearchInputRef,
                                        excludedEpicSearchOpen,
                                        excludedEpicSearchLoading,
                                        filteredExcludedEpicSearchResults,
                                        excludedEpicSearchIndex,
                                        addGroupExcludedCapacityEpic,
                                        removeGroupExcludedCapacityEpic,
                                        excludedEpicChipLastRef,
                                        showGroupAdvanced,
                                        setShowGroupAdvanced,
                                        showGroupImport,
                                        setShowGroupImport,
                                        exportGroupsConfig,
                                        groupImportText,
                                        setGroupImportText,
                                        importGroupsConfig,
                                        removeGroupDraft,
                                    }}
                                />
                                </div>
                                )}
                                {groupManageTab === 'labels' && (
                                <div
                                    id="department-settings-labels-panel"
                                    role="tabpanel"
                                    aria-labelledby="department-settings-labels-tab"
                                >
                                <div className="group-modal-body group-modal-split">
                                    <div className="group-pane group-list-pane">
                                        <div className="group-pane-header">
                                            <div className="group-pane-title">Groups</div>
                                            <div className="group-pane-subtitle">Choose a team group to map one Jira label per team.</div>
                                        </div>
                                        <div className="group-pane-list">
                                            {(filteredGroupDrafts || []).map((group) => {
                                                const isActive = activeGroupDraft?.id === group.id;
                                                const teamCount = (group.teamIds || []).length;
                                                return (
                                                    <button
                                                        key={`label-group-${group.id}`}
                                                        className={`group-list-item ${isActive ? 'active' : ''}`}
                                                        onClick={() => {
                                                            setActiveGroupDraftId(group.id);
                                                            setShowGroupListMobile(false);
                                                        }}
                                                        type="button"
                                                    >
                                                        <div className="group-list-line">
                                                            <span className="group-list-name">{group.name || 'Untitled group'}</span>
                                                            <span className="group-list-dot">·</span>
                                                            <span className="group-list-meta">{teamCount} team{teamCount !== 1 ? 's' : ''}</span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="group-pane group-editor-pane">
                                        <div className="group-pane-header">
                                            <div className="group-pane-title">Team labels</div>
                                            <div className="group-pane-subtitle">Assign the team-specific epic label used with the selected sprint label.</div>
                                        </div>
                                        {!activeGroupDraft ? (
                                            <div className="group-pane-empty">Select a group to edit its team label mappings.</div>
                                        ) : (activeGroupDraft.teamIds || []).length === 0 ? (
                                            <div className="group-pane-empty">Add teams in Team groups first, then return here to map labels.</div>
                                        ) : (
                                            <div className="group-pane-list">
                                                {(activeGroupDraft.teamIds || []).map((teamId) => {
                                                    const rowKey = getLabelRowKey(activeGroupDraft.id, teamId);
                                                    const currentLabel = activeGroupDraft?.teamLabels?.[teamId] || '';
                                                    const results = getLabelSearchResults(activeGroupDraft.id, teamId);
                                                    const query = String(labelSearchQuery[rowKey] || '').trim();
                                                    const isSearching = Boolean(labelSearchLoading[rowKey]);
                                                    const activeIndex = Math.min(labelSearchIndex[rowKey] || 0, Math.max(results.length - 1, 0));
                                                    return (
                                                        <div key={rowKey} className="group-projects-subsection" style={{ marginTop: 0, paddingBottom: '1rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(10rem, 13rem) minmax(0, 1fr)', alignItems: 'center', gap: '0.75rem' }}>
                                                                <div className="team-selector-label" style={{ margin: 0 }}>{resolveTeamName(teamId)}</div>
                                                                {currentLabel ? (
                                                                    <div className="selected-team-chip">
                                                                        <span className="team-name">{currentLabel}</span>
                                                                        <button
                                                                            className="remove-btn"
                                                                            onClick={() => setTeamLabelForGroup(activeGroupDraft.id, teamId, '')}
                                                                            type="button"
                                                                            title="Remove label"
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="team-search-wrapper" style={{ minWidth: 0 }}>
                                                                        <input
                                                                            type="text"
                                                                            className="team-search-input"
                                                                            placeholder="Type at least 3 characters..."
                                                                            value={labelSearchQuery[rowKey] || ''}
                                                                            onChange={(event) => {
                                                                            const value = event.target.value;
                                                                            setLabelSearchQuery(prev => ({ ...prev, [rowKey]: value }));
                                                                            setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
                                                                            setLabelSearchIndex(prev => ({ ...prev, [rowKey]: 0 }));
                                                                            scheduleJiraLabelSearch(activeGroupDraft.id, teamId, value);
                                                                        }}
                                                                            onFocus={() => {
                                                                                setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
                                                                            }}
                                                                            onBlur={() => window.setTimeout(() => setLabelSearchOpen(prev => ({ ...prev, [rowKey]: false })), 120)}
                                                                            onKeyDown={(event) => handleLabelSearchKeyDown(activeGroupDraft.id, teamId, event, results)}
                                                                        />
                                                                        {labelSearchOpen[rowKey] && (
                                                                            <div className="team-search-results" onMouseDown={(event) => event.preventDefault()}>
                                                                                {query.length < 3 ? (
                                                                                    <div className="team-search-result-item is-empty">Type at least 3 characters</div>
                                                                                ) : results.length === 0 ? (
                                                                                    <div className="team-search-result-item is-empty">{isSearching ? 'Searching labels...' : 'No labels found'}</div>
                                                                                ) : results.map((label, index) => (
                                                                                    <div
                                                                                        key={`${rowKey}-${label}`}
                                                                                        className={`team-search-result-item ${activeIndex === index ? 'active' : ''}`}
                                                                                        onMouseEnter={() => setLabelSearchIndex(prev => ({ ...prev, [rowKey]: index }))}
                                                                                        onClick={() => selectTeamLabel(activeGroupDraft.id, teamId, label)}
                                                                                    >
                                                                                        {label}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                </div>
                                )}
                                </>
                                )}
                        </SettingsModal>
                    )}
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
            );
        }

        const rootElement = document.getElementById('root');
        if (rootElement) {
            const root = createRoot(rootElement);
            root.render(<App />);
        }
    
