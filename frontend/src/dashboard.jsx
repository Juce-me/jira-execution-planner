import * as React from 'react';
import { createRoot } from 'react-dom/client';

        const { useState, useEffect, useRef } = React;
        const EMPTY_ARRAY = Object.freeze([]);
        const EMPTY_OBJECT = Object.freeze({});

        // Backend server URL
        const DEFAULT_BACKEND_PORT = 5050;
        const BACKEND_URL = window.BACKEND_URL ||
            (window.location.protocol.startsWith('http')
                ? `${window.location.protocol}//${window.location.hostname}:${DEFAULT_BACKEND_PORT}`
                : `http://localhost:${DEFAULT_BACKEND_PORT}`);

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
            const [showKilled, setShowKilled] = useState(savedPrefsRef.current.showKilled ?? false);
            const [showDone, setShowDone] = useState(savedPrefsRef.current.showDone ?? true);
            const [showTech, setShowTech] = useState(savedPrefsRef.current.showTech ?? true);
            const [showProduct, setShowProduct] = useState(savedPrefsRef.current.showProduct ?? true);
            const [sprintName, setSprintName] = useState('Sprint');
            const [statusFilter, setStatusFilter] = useState(savedPrefsRef.current.statusFilter ?? null); // null = show all, 'in-progress', 'todo-accepted', 'done', 'high-priority'
            const [selectedSprint, setSelectedSprint] = useState(savedPrefsRef.current.selectedSprint ?? null); // Sprint ID
            const [availableSprints, setAvailableSprints] = useState([]);
            const [sprintsLoading, setSprintsLoading] = useState(true);
            const [groupsConfig, setGroupsConfig] = useState({
                version: 1,
                groups: [],
                defaultGroupId: '',
                teamCatalog: {},
                teamCatalogMeta: {}
            });
            const [groupsLoading, setGroupsLoading] = useState(true);
            const [groupsError, setGroupsError] = useState('');
            const [groupWarnings, setGroupWarnings] = useState([]);
            const [groupConfigSource, setGroupConfigSource] = useState('');
            const [activeGroupId, setActiveGroupId] = useState(savedPrefsRef.current.activeGroupId ?? null);
            const [showGroupDropdown, setShowGroupDropdown] = useState(false);
            const groupDropdownRef = useRef(null);
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
            const [groupSearchQuery, setGroupSearchQuery] = useState('');
            const [activeGroupDraftId, setActiveGroupDraftId] = useState(null);
            const [showGroupListMobile, setShowGroupListMobile] = useState(false);
            const [showGroupDiscardConfirm, setShowGroupDiscardConfirm] = useState(false);
            const groupDraftBaselineRef = useRef('');
            const [groupQueryTemplateEnabled, setGroupQueryTemplateEnabled] = useState(false);
            const [groupManageTab, setGroupManageTab] = useState('scope');
            const [showTechnicalFieldIds, setShowTechnicalFieldIds] = useState(false);
            const [settingsAdminOnly, setSettingsAdminOnly] = useState(true);
            const [userCanEditSettings, setUserCanEditSettings] = useState(true);
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
            const [missingInfoEpics, setMissingInfoEpics] = useState([]);
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
            const pageLoadRefreshRef = useRef(true);
            const [jiraUrl, setJiraUrl] = useState('');
            const [selectedTasks, setSelectedTasks] = useState({});
            const [showPlanning, setShowPlanning] = useState(savedPrefsRef.current.showPlanning ?? false);
            const [showStats, setShowStats] = useState(savedPrefsRef.current.showStats ?? false);
            const [showScenario, setShowScenario] = useState(savedPrefsRef.current.showScenario ?? false);
            const [showDependencies, setShowDependencies] = useState(true);
            const [searchQuery, setSearchQuery] = useState(savedPrefsRef.current.searchQuery ?? '');
            const [searchInput, setSearchInput] = useState(savedPrefsRef.current.searchQuery ?? '');
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
            const [planningOffset, setPlanningOffset] = useState(0);
            const [isPlanningStuck, setIsPlanningStuck] = useState(false);
            const planningPanelRef = useRef(null);
            const resolveStatsView = (value) => (value === 'teams' || value === 'priority') ? value : 'teams';
            const resolveStatsGraphMode = (value) => (value === 'weighted' || value === 'absolute') ? value : 'weighted';
            const [statsView, setStatsView] = useState(resolveStatsView(savedPrefsRef.current.statsView));
            const [statsGraphMode, setStatsGraphMode] = useState(resolveStatsGraphMode(savedPrefsRef.current.statsGraphMode));
            const [priorityHoverIndex, setPriorityHoverIndex] = useState(null);
            const [showTeamDropdown, setShowTeamDropdown] = useState(false);
            const teamDropdownRef = useRef(null);
            const [sprintSearch, setSprintSearch] = useState('');
            const [showSprintDropdown, setShowSprintDropdown] = useState(false);
            const sprintDropdownRef = useRef(null);
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
            const [scenarioHoverKey, setScenarioHoverKey] = useState(null);
            const [scenarioFlashKey, setScenarioFlashKey] = useState(null);
            const [scenarioScrollTop, setScenarioScrollTop] = useState(0);
            const searchInputRef = useRef(null);
            const [scenarioScrollLeft, setScenarioScrollLeft] = useState(0);
            const [scenarioViewportHeight, setScenarioViewportHeight] = useState(0);
            const [scenarioEpicFocus, setScenarioEpicFocus] = useState(null);
            const [scenarioRangeOverride, setScenarioRangeOverride] = useState(null);
            const scenarioFocusRestoreRef = useRef(null);
            const scenarioSkipAutoCollapseRef = useRef(false);
            const scenarioTeamCollapseInitRef = useRef(false);
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
            const [showWaitingAlert, setShowWaitingAlert] = useState(savedPrefsRef.current.showWaitingAlert ?? true);
            const [showEmptyEpicAlert, setShowEmptyEpicAlert] = useState(savedPrefsRef.current.showEmptyEpicAlert ?? true);
            const [showDoneEpicAlert, setShowDoneEpicAlert] = useState(savedPrefsRef.current.showDoneEpicAlert ?? true);
            const [dismissedAlertKeys, setDismissedAlertKeys] = useState([]);
            const [alertCelebrationPieces, setAlertCelebrationPieces] = useState([]);
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
                loadSprints();
            }, []);

            useEffect(() => {
                let cancelled = false;
                const fetchVersion = async () => {
                    try {
                        const response = await fetch(`${BACKEND_URL}/api/version`, { cache: 'no-cache' });
                        if (!response.ok) return;
                        const data = await response.json();
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
                    teamCatalog: normalized.teamCatalog || {},
                    teamCatalogMeta: normalized.teamCatalogMeta || {}
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
                setGroupManageTab('scope');
                setProjectSearchQuery('');
                setActiveGroupDraftId(resolveInitialGroupId(normalized));
                loadSelectedProjects();
                loadBoardConfig();
                loadCapacityConfig();
                loadSprintFieldConfig();
                loadParentNameFieldConfig();
                loadStoryPointsFieldConfig();
                loadTeamFieldConfig();
                loadIssueTypesConfig();
                fetchAvailableIssueTypes();
                if (!jiraProjects.length) fetchJiraProjects();
                if (!jiraBoards.length) fetchJiraBoards();
                const catalogTeams = buildTeamCatalogList(normalized.teamCatalog);
                if (catalogTeams.length) {
                    setAvailableTeams(catalogTeams);
                } else {
                    setAvailableTeams(loadTeamsFromCurrentView());
                }
                setLoadingTeams(false);
                const missingIds = new Set();
                (normalized.groups || []).forEach(group => {
                    (group.teamIds || []).forEach(teamId => {
                        if (!normalized.teamCatalog?.[teamId]) {
                            missingIds.add(teamId);
                        }
                    });
                });
                if (missingIds.size) {
                    resolveMissingTeamNames(Array.from(missingIds));
                }
            }, [showGroupManage, groupsConfig]);

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

            const normalizeScenarioSummary = (summary) => {
                const text = String(summary || '').trim();
                if (!text) return '';
                return text.replace(/^issue\.\s*/i, '');
            };

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
                            : (group?.missingInfoComponent ? [String(group.missingInfoComponent).trim()] : [])
                    }))
                    .filter(group => group.id && group.name);
                const rawCatalog = config?.teamCatalog || {};
                const teamCatalog = {};
                if (Array.isArray(rawCatalog)) {
                    rawCatalog.forEach(entry => {
                        if (!entry) return;
                        const id = String(entry.id || '').trim();
                        const name = String(entry.name || '').trim();
                        if (id && name) {
                            teamCatalog[id] = { id, name };
                        }
                    });
                } else if (rawCatalog && typeof rawCatalog === 'object') {
                    Object.entries(rawCatalog).forEach(([key, value]) => {
                        if (value && typeof value === 'object') {
                            const id = String(value.id || key || '').trim();
                            const name = String(value.name || '').trim();
                            if (id && name) {
                                teamCatalog[id] = { id, name };
                            }
                            return;
                        }
                        const id = String(key || '').trim();
                        const name = String(value || '').trim();
                        if (id && name) {
                            teamCatalog[id] = { id, name };
                        }
                    });
                }
                const meta = config?.teamCatalogMeta && typeof config.teamCatalogMeta === 'object'
                    ? config.teamCatalogMeta
                    : {};
                return {
                    version: Number(config?.version) || 1,
                    groups,
                    defaultGroupId: String(config?.defaultGroupId || '').trim(),
                    teamCatalog,
                    teamCatalogMeta: {
                        updatedAt: meta.updatedAt ? String(meta.updatedAt) : '',
                        sprintId: meta.sprintId ? String(meta.sprintId) : '',
                        sprintName: meta.sprintName ? String(meta.sprintName) : '',
                        source: meta.source ? String(meta.source) : '',
                        resolvedAt: meta.resolvedAt ? String(meta.resolvedAt) : ''
                    }
                };
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
                    const response = await fetch(`${BACKEND_URL}/api/groups-config`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
                    if (!response.ok) {
                        throw new Error(`Groups config error ${response.status}`);
                    }
                    const payload = await response.json();
                    const normalized = normalizeGroupsConfig(payload);
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
                    setGroupsError(err.message || 'Failed to load groups config.');
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
                    const sprintParam = selectedSprint || '';
                    const url = `${BACKEND_URL}/api/teams?_t=${Date.now()}&sprint=${sprintParam}&all=true`;

                    const response = await fetch(url);

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
                    handleGroupDraftChange(prev => ({
                        ...prev,
                        teamCatalog: mergeTeamCatalog(prev.teamCatalog, fetchedTeams),
                        teamCatalogMeta: {
                            updatedAt: new Date().toISOString(),
                            sprintId: String(selectedSprint || ''),
                            sprintName: selectedSprintInfo?.name ? String(selectedSprintInfo.name) : '',
                            source: 'sprint'
                        }
                    }));
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
                    const params = new URLSearchParams({
                        teamIds: teamIds.join(','),
                        t: Date.now().toString()
                    });
                    const response = await fetch(`${BACKEND_URL}/api/teams/resolve?${params.toString()}`);
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
                    handleGroupDraftChange(prev => ({
                        ...prev,
                        teamCatalog: mergeTeamCatalog(prev.teamCatalog, resolvedTeams),
                        teamCatalogMeta: {
                            ...(prev.teamCatalogMeta || {}),
                            resolvedAt: new Date().toISOString()
                        }
                    }));
                } catch (err) {
                    console.warn('Failed to resolve team names:', err);
                }
            };

            const openGroupManage = () => {
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
                setGroupManageTab('scope');
                setProjectSearchQuery('');
                setProjectSearchOpen(false);
                setProjectSearchIndex(0);
                setBoardSearchQuery('');
                setBoardSearchOpen(false);
                setBoardSearchIndex(0);
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
                    teamCatalog: groupDraft.teamCatalog || {},
                    teamCatalogMeta: groupDraft.teamCatalogMeta || {}
                });
            }, [groupDraft]);

            const isProjectsDraftDirty = React.useMemo(() => {
                return JSON.stringify(selectedProjectsDraft) !== selectedProjectsBaselineRef.current;
            }, [selectedProjectsDraft]);

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

            const isGroupDraftDirty = React.useMemo(() => {
                if (isProjectsDraftDirty) return true;
                if (isBoardConfigDirty) return true;
                if (isCapacityDraftDirty) return true;
                if (isIssueTypesDraftDirty) return true;
                if (isSprintFieldDirty) return true;
                if (isParentNameFieldDirty) return true;
                if (isStoryPointsFieldDirty) return true;
                if (isTeamFieldDirty) return true;
                if (!groupDraft) return false;
                return groupDraftSignature !== groupDraftBaselineRef.current;
            }, [groupDraftSignature, groupDraft, isProjectsDraftDirty, isBoardConfigDirty, isCapacityDraftDirty, isIssueTypesDraftDirty, isSprintFieldDirty, isParentNameFieldDirty, isStoryPointsFieldDirty, isTeamFieldDirty]);
            const unsavedSectionsCount = React.useMemo(() => {
                return [
                    isProjectsDraftDirty,
                    isBoardConfigDirty,
                    isCapacityDraftDirty,
                    isIssueTypesDraftDirty,
                    isSprintFieldDirty,
                    isParentNameFieldDirty,
                    isStoryPointsFieldDirty,
                    isTeamFieldDirty,
                    Boolean(groupDraft && groupDraftSignature !== groupDraftBaselineRef.current)
                ].filter(Boolean).length;
            }, [isProjectsDraftDirty, isBoardConfigDirty, isCapacityDraftDirty, isIssueTypesDraftDirty, isSprintFieldDirty, isParentNameFieldDirty, isStoryPointsFieldDirty, isTeamFieldDirty, groupDraft, groupDraftSignature]);
            const groupConfigValidationErrors = React.useMemo(() => {
                const errors = [];
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
                return errors;
            }, [selectedProjectsDraft, sprintFieldIdDraft, parentNameFieldIdDraft, storyPointsFieldIdDraft, teamFieldIdDraft, capacityProjectDraft, capacityFieldIdDraft]);
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

            useEffect(() => {
                if (!showGroupManage) return;
                const handleKey = (event) => {
                    const key = event.key;
                    if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 's') {
                        event.preventDefault();
                        if (!groupSaving) {
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
            }, [showGroupManage, groupSaving, teamSearchOpen, showGroupDiscardConfirm, requestCloseGroupManage]);

            const addGroupDraftRow = () => {
                let nextId = '';
                handleGroupDraftChange(prev => {
                    const existingIds = new Set((prev.groups || []).map(group => group.id));
                    nextId = buildGroupId('New Group', existingIds);
                    const nextGroup = { id: nextId, name: 'New Group', teamIds: [] };
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
                        return { ...group, teamIds: [...currentTeams, teamId] };
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
                        return { ...group, teamIds: (group.teamIds || []).filter(id => id !== teamId) };
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
                    const response = await fetch(`${BACKEND_URL}/api/test`);
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
                    // Save project selection if changed
                    const projectsChanged = isProjectsDraftDirty;
                    if (projectsChanged) {
                        await saveProjectSelection();
                    }

                    const boardChanged = isBoardConfigDirty;
                    if (boardChanged) {
                        await saveBoardConfig();
                    }

                    // Save capacity config if changed
                    const capacityChanged = isCapacityDraftDirty;
                    if (capacityChanged) {
                        await saveCapacityConfig();
                    }

                    // Save custom field configs if changed
                    if (isSprintFieldDirty) await saveSprintFieldConfig();
                    if (isParentNameFieldDirty) await saveParentNameFieldConfig();
                    if (isStoryPointsFieldDirty) await saveStoryPointsFieldConfig();
                    if (isTeamFieldDirty) await saveTeamFieldConfig();
                    const fieldConfigsChanged = isSprintFieldDirty || isParentNameFieldDirty || isStoryPointsFieldDirty || isTeamFieldDirty;

                    // Save issue types config if changed
                    const issueTypesChanged = isIssueTypesDraftDirty;
                    if (issueTypesChanged) {
                        await saveIssueTypesConfig();
                    }

                    // Capture the current active group's team IDs before saving
                    const currentActiveGroup = activeGroupId ? (groupsConfig.groups || []).find(g => g.id === activeGroupId) : null;
                    const currentTeamSignature = currentActiveGroup ? (currentActiveGroup.teamIds || []).join('|') : null;

                    const response = await fetch(`${BACKEND_URL}/api/groups-config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            version: groupDraft.version || 1,
                            groups: groupDraft.groups || [],
                            defaultGroupId: groupDraft.defaultGroupId || '',
                            teamCatalog: groupDraft.teamCatalog || {},
                            teamCatalogMeta: groupDraft.teamCatalogMeta || {}
                        })
                    });
                    if (!response.ok) {
                        const errorPayload = await response.json().catch(() => ({}));
                        const errorMessage = (errorPayload.errors || []).join(' ') || errorPayload.error || `Save failed (${response.status})`;
                        throw new Error(errorMessage);
                    }
                    const payload = await response.json();
                    const normalized = normalizeGroupsConfig(payload);

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
                    if (projectsChanged || boardChanged || capacityChanged || issueTypesChanged || fieldConfigsChanged) {
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
                        const cfgResp = await fetch(`${BACKEND_URL}/api/config`);
                        if (cfgResp.ok) {
                            const cfg = await cfgResp.json();
                            setCapacityEnabled(Boolean(cfg.capacityProject));
                            setSettingsAdminOnly(Boolean(cfg.settingsAdminOnly));
                            setUserCanEditSettings(cfg.userCanEditSettings !== false);
                        }
                    } catch (_) { /* best-effort */ }

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

            const fetchJiraProjects = async () => {
                setLoadingProjects(true);
                try {
                    const response = await fetch(`${BACKEND_URL}/api/projects`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
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
                    const response = await fetch(`${BACKEND_URL}/api/boards`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
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
                        const params = new URLSearchParams();
                        params.set('query', query);
                        params.set('limit', '25');
                        const response = await fetch(`${BACKEND_URL}/api/projects?${params.toString()}`, {
                            method: 'GET',
                            headers: { 'Content-Type': 'application/json' },
                            cache: 'no-cache',
                            signal: controller.signal
                        });
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
                        const params = new URLSearchParams();
                        params.set('query', query);
                        params.set('limit', '15');
                        const response = await fetch(`${BACKEND_URL}/api/components?${params.toString()}`, {
                            method: 'GET',
                            headers: { 'Content-Type': 'application/json' },
                            cache: 'no-cache',
                            signal: controller.signal
                        });
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

            const filteredComponentSearchResults = React.useMemo(() => {
                const group = activeGroupDraftId
                    ? (groupDraft?.groups || []).find(g => g.id === activeGroupDraftId)
                    : null;
                const selected = new Set((group?.missingInfoComponents || []).map(c => c.toLowerCase()));
                return componentSearchResults.filter(c => !selected.has(c.name.toLowerCase()));
            }, [componentSearchResults, groupDraft, activeGroupDraftId]);

            React.useEffect(() => {
                const maxIndex = filteredComponentSearchResults.length - 1;
                if (componentSearchIndex > maxIndex) setComponentSearchIndex(0);
            }, [filteredComponentSearchResults.length]);

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

            const loadSelectedProjects = async () => {
                try {
                    const response = await fetch(`${BACKEND_URL}/api/projects/selected`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
                    if (!response.ok) throw new Error(`Selected projects fetch error ${response.status}`);
                    const data = await response.json();
                    const selected = data.selected || [];
                    setSelectedProjectsDraft(selected);
                    setSavedSelectedProjects(selected);
                    selectedProjectsBaselineRef.current = JSON.stringify(selected);
                } catch (err) {
                    console.error('Failed to load selected projects:', err);
                }
            };

            const loadBoardConfig = async () => {
                try {
                    const response = await fetch(`${BACKEND_URL}/api/board-config`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
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

            const saveBoardConfig = async () => {
                const response = await fetch(`${BACKEND_URL}/api/board-config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ boardId: boardIdDraft, boardName: boardNameDraft })
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${response.status})`);
                }
                boardConfigBaselineRef.current = JSON.stringify({ boardId: boardIdDraft, boardName: boardNameDraft });
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

            const removeProjectSelection = (key) => {
                setSelectedProjectsDraft(prev => prev.filter(p => p.key !== key));
            };

            const selectedProjectKeys = React.useMemo(() => {
                return new Set(selectedProjectsDraft.map(p => p.key));
            }, [selectedProjectsDraft]);

            const boardSearchResults = React.useMemo(() => {
                const query = boardSearchQuery.trim().toLowerCase();
                if (!query) return [];
                return (jiraBoards || [])
                    .filter((board) => {
                        const id = String(board.id || '');
                        const name = String(board.name || '');
                        const type = String(board.type || '');
                        return id.includes(query) || name.toLowerCase().includes(query) || type.toLowerCase().includes(query);
                    })
                    .slice(0, 20);
            }, [boardSearchQuery, jiraBoards]);

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
                    const response = await fetch(`${BACKEND_URL}/api/projects/selected`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ selected: selectedProjectsDraft })
                    });
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
                    const response = await fetch(`${BACKEND_URL}/api/capacity/config`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
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
                const response = await fetch(`${BACKEND_URL}/api/capacity/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft })
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${response.status})`);
                }
                capacityBaselineRef.current = JSON.stringify({ project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft });
            };

            // Generic load/save helpers for custom field pickers
            const loadFieldConfig = async (endpoint, setId, setName, baselineRef) => {
                try {
                    const response = await fetch(`${BACKEND_URL}/api/${endpoint}/config`, { method: 'GET', headers: { 'Content-Type': 'application/json' }, cache: 'no-cache' });
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
                const response = await fetch(`${BACKEND_URL}/api/${endpoint}/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fieldId, fieldName })
                });
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
                    const response = await fetch(`${BACKEND_URL}/api/issue-types/config`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
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
                const response = await fetch(`${BACKEND_URL}/api/issue-types/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ issueTypes: issueTypesDraft })
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${response.status})`);
                }
                issueTypesBaselineRef.current = JSON.stringify(issueTypesDraft);
            };

            const fetchAvailableIssueTypes = async () => {
                try {
                    const response = await fetch(`${BACKEND_URL}/api/issue-types`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
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
                    const params = projectKey ? `?project=${encodeURIComponent(projectKey)}` : '';
                    const response = await fetch(`${BACKEND_URL}/api/fields${params}`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
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
                    teamCatalog: source.teamCatalog || {},
                    teamCatalogMeta: source.teamCatalogMeta || {}
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
                const catalog = groupDraft?.teamCatalog || {};
                Object.keys(catalog).forEach(teamId => {
                    if (!map[teamId]) {
                        map[teamId] = catalog[teamId];
                    }
                });
                return map;
            }, [availableTeams, groupDraft]);

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
                return groupDraft?.teamCatalogMeta || groupsConfig.teamCatalogMeta || {};
            }, [groupDraft, groupsConfig]);

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

            const activeGroupTeamSet = React.useMemo(() => new Set(activeGroupTeamIds), [activeGroupTeamIds]);

            const buildDefaultGroupState = (groupId) => {
                const selectedTasksCookie = groupId ? (getCookie(`selectedTasks_${groupId}`) || {}) : {};
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
                    selectedTeams: normalizeSelectedTeams(savedPrefsRef.current.selectedTeams ?? savedPrefsRef.current.selectedTeam ?? 'all'),
                    selectedTasks: selectedTasksCookie,
                    showPlanning: savedPrefsRef.current.showPlanning ?? false,
                    showStats: savedPrefsRef.current.showStats ?? false,
                    showScenario: false,
                    showDependencies: true,
                    epicDetails: {},
                    statsView: resolveStatsView(savedPrefsRef.current.statsView),
                    statsGraphMode: resolveStatsGraphMode(savedPrefsRef.current.statsGraphMode),
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
                    showWaitingAlert: savedPrefsRef.current.showWaitingAlert ?? true,
                    showEmptyEpicAlert: savedPrefsRef.current.showEmptyEpicAlert ?? true,
                    showDoneEpicAlert: savedPrefsRef.current.showDoneEpicAlert ?? true,
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
                showWaitingAlert,
                showEmptyEpicAlert,
                showDoneEpicAlert,
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
                setShowWaitingAlert(nextState.showWaitingAlert ?? true);
                setShowEmptyEpicAlert(nextState.showEmptyEpicAlert ?? true);
                setShowDoneEpicAlert(nextState.showDoneEpicAlert ?? true);
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
                if (cached) {
                    applyGroupState(cached);
                } else {
                    const fallback = buildDefaultGroupState(activeGroupId);
                    groupStateRef.current.set(activeGroupId, fallback);
                    applyGroupState(fallback);
                }
                setShowGroupDropdown(false);
            }, [activeGroupId]);


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
                if (showPlanning && !isCompletedSprintSelected) {
                    includePlanningTasksByStatus(['Accepted', 'In Progress']);
                }
            }, [showPlanning, isCompletedSprintSelected]);

            useEffect(() => {
                if (!selectedSprint) return;
                if (!showSprintDropdown) return;
                const optionEl = sprintDropdownRef.current?.querySelector(`[data-sprint-id="${selectedSprint}"]`);
                if (!optionEl) return;
                if (optionEl.scrollIntoView) {
                    optionEl.scrollIntoView({ block: 'center' });
                }
            }, [showSprintDropdown, selectedSprint, filteredSprints?.length]);

            const resetSprintScopedState = React.useCallback(() => {
                abortSprintFetches();
                setDependencyData({});
                setDependencyFocus(null);
                setDependencyLookupCache({});
                setDependencyLookupLoading(false);
                setMissingPlanningInfoTasks([]);
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
                    if (!teamDropdownRef.current) return;
                    if (!teamDropdownRef.current.contains(event.target)) {
                        setShowTeamDropdown(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, []);

            useEffect(() => {
                const handleClickOutside = (event) => {
                    if (!sprintDropdownRef.current) return;
                    if (!sprintDropdownRef.current.contains(event.target)) {
                        setShowSprintDropdown(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, []);

            useEffect(() => {
                const handleClickOutside = (event) => {
                    if (!groupDropdownRef.current) return;
                    if (!groupDropdownRef.current.contains(event.target)) {
                        setShowGroupDropdown(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, []);

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
                // Save selected tasks to cookie whenever they change
                if (!activeGroupId) return;
                setCookie(`selectedTasks_${activeGroupId}`, selectedTasks);
            }, [selectedTasks, activeGroupId]);

            useEffect(() => {
                saveUiPrefs({
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
                    scenarioLaneMode,
                    excludedStatsEpics,
                    hideExcludedStats,
                    showMissingAlert,
                    showBlockedAlert,
                    showPostponedAlert,
                    showWaitingAlert,
                    showEmptyEpicAlert,
                    showDoneEpicAlert,
                    updateDismissedHash
                });
            }, [
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
                scenarioLaneMode,
                excludedStatsEpics,
                hideExcludedStats,
                showMissingAlert,
                showBlockedAlert,
                showPostponedAlert,
                showEmptyEpicAlert,
                showDoneEpicAlert,
                updateDismissedHash
            ]);

            const loadConfig = async () => {
                try {
                    const response = await fetch(`${BACKEND_URL}/api/config`);
                    if (response.ok) {
                        const config = await response.json();
                        setJiraUrl(config.jiraUrl || '');
                        setCapacityEnabled(Boolean(config.capacityProject));
                        setGroupQueryTemplateEnabled(Boolean(config.groupQueryTemplateEnabled));
                        setSettingsAdminOnly(Boolean(config.settingsAdminOnly));
                        setUserCanEditSettings(config.userCanEditSettings !== false);
                    }
                } catch (err) {
                    console.error('Failed to load config:', err);
                }
            };

            useEffect(() => {
                // Load tasks when sprint changes (team is filtered client-side)
                if (selectedSprint === null) {
                    return;
                }

                // Wait for groups config to load before loading tasks
                if (groupsLoading) {
                    return;
                }

                // Only skip loading if we have actual cached data
                const shouldSkipLoad = activeGroupId && (() => {
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

                setEpicDetails({});
                setProductEpicsInScope([]);
                setTechEpicsInScope([]);
                setMissingPlanningInfoTasks([]);
                setMissingInfoEpics([]);
                loadProductTasks();
                loadTechTasks();
                fetchMissingPlanningInfo(selectedSprint);
            }, [selectedSprint, activeGroupId, activeGroupTeamIds.join('|'), groupsLoading, (activeGroup?.missingInfoComponents || []).join(',')]);

            const fetchMissingPlanningInfo = async (sprintId) => {
                const controller = registerSprintFetch();
                try {
                    if (!sprintId) return;
                    if (activeGroupId && activeGroupTeamIds.length === 0) {
                        setMissingPlanningInfoTasks([]);
                        return;
                    }
                    const params = new URLSearchParams({ sprint: String(sprintId), t: Date.now().toString() });
                    if (activeGroupTeamIds.length) {
                        params.set('teamIds', activeGroupTeamIds.join(','));
                    }
                    const groupComponents = activeGroup?.missingInfoComponents || [];
                    if (groupComponents.length) {
                        params.set('components', groupComponents.join(','));
                    }
                    const response = await fetch(`${BACKEND_URL}/api/missing-info?${params.toString()}`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache',
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
                    const params = new URLSearchParams({
                        t: Date.now().toString()
                    });
                    if (forceRefresh) {
                        params.append('refresh', 'true');
                    }
                    const response = await fetch(`${BACKEND_URL}/api/sprints?${params}`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        cache: 'no-cache'
                    });

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
                } catch (err) {
                    console.error('Failed to load sprints:', err);
                    setError(`Failed to load sprints: ${err.message}`);
                } finally {
                    setSprintsLoading(false);
                }
            };

            const priorityOrder = {
                'Blocker': 0,
                'Highest': 1,
                'Critical': 2,
                'High': 3,
                'Major': 4,
                'Medium': 5,
                'Minor': 6,
                'Low': 7,
                'Trivial': 8,
                'Lowest': 9
            };

            const fetchCapacity = async (sprintName) => {
                if (!capacityEnabled || !sprintName) return;
                setCapacityLoading(true);
                try {
                    const teams = capacityTeamNames;
                    const params = new URLSearchParams({
                        sprint: sprintName,
                        t: Date.now().toString()
                    });
                    if (teams.length) {
                        params.append('teams', teams.join(','));
                    }
                    const response = await fetch(`${BACKEND_URL}/api/capacity?${params.toString()}`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        cache: 'no-cache'
                    });
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

            const priorityAxis = ['Blocker', 'Critical', 'Major', 'Minor', 'Low', 'Trivial'];
            const priorityLabelByKey = {
                blocker: 'Blocker',
                critical: 'Critical',
                major: 'Major',
                minor: 'Minor',
                low: 'Low',
                trivial: 'Trivial'
            };
            const radarPalette = [
                '#2563eb',
                '#0ea5e9',
                '#14b8a6',
                '#10b981',
                '#22c55e',
                '#84cc16',
                '#eab308',
                '#f59e0b',
                '#f97316',
                '#a855f7',
                '#6366f1',
                '#64748b'
            ];

            const hashTeamId = (value) => {
                const str = String(value || '');
                let hash = 5381;
                for (let i = 0; i < str.length; i += 1) {
                    hash = ((hash << 5) + hash) + str.charCodeAt(i);
                }
                return Math.abs(hash);
            };

            const resolveTeamColor = (teamId) => {
                if (!radarPalette.length) return '#94a3b8';
                const index = hashTeamId(teamId) % radarPalette.length;
                return radarPalette[index];
            };

            const getTeamInfo = (task) => {
                const team = task.fields?.team;
                const teamName = task.fields?.teamName || team?.name || team?.displayName || team?.teamName || 'Unknown Team';
                const teamId = task.fields?.teamId || team?.id || team?.teamId || team?.key || teamName;
                return { id: teamId, name: teamName };
            };

            const getEpicTeamInfo = (epic) => {
                const teamName = epic?.teamName || epic?.team?.name || epic?.team?.displayName || 'Unknown Team';
                const teamId = epic?.teamId || epic?.team?.id || teamName;
                return { id: teamId, name: teamName };
            };

            const groupTasksByTeam = (tasks) => {
                const groups = new Map();
                (tasks || []).forEach(task => {
                    const teamName = getTeamInfo(task).name;
                    const items = groups.get(teamName) || [];
                    items.push(task);
                    groups.set(teamName, items);
                });
                return Array.from(groups.entries()).map(([teamName, items]) => ({ teamName, items }));
            };

            const filterTasksForActiveGroup = (items) => {
                if (!activeGroupTeamIds.length) return [];
                return (items || []).filter(task => activeGroupTeamSet.has(getTeamInfo(task).id));
            };

            const fetchTasks = async (project, options = {}) => {
                const useLoading = options.useLoading !== false;
                const setErrors = options.setErrorOnFailure !== false;
                if (useLoading) {
                    setLoading(true);
                }
                if (setErrors && options.clearError !== false) {
                    setError('');
                }

                const controller = registerSprintFetch();
                try {
                    const sprintParam = options.sprintOverride !== undefined ? options.sprintOverride : (selectedSprint || '');
                    const groupTeamIds = activeGroupTeamIds;
                    const useGroupTemplate = groupQueryTemplateEnabled && groupTeamIds.length > 0;
                    // Add cache busting parameter and sprint parameter
                    const params = new URLSearchParams({
                        t: Date.now().toString(),
                        sprint: sprintParam,
                        team: 'all',
                        project: project || 'all',
                        groupId: activeGroupId || ''
                    });
                    // On page load, bypass server cache to get fresh Jira data
                    if (pageLoadRefreshRef.current) {
                        params.set('refresh', 'true');
                        pageLoadRefreshRef.current = false;
                    }
                    // If group has teams configured, always filter by them (overrides ENV filter)
                    if (groupTeamIds.length > 0) {
                        params.set('teamIds', groupTeamIds.join(','));
                    }
                    if (options.purpose) {
                        params.set('purpose', String(options.purpose));
                    }
                    if (options.epicKeys && options.epicKeys.length) {
                        const epicKeys = Array.from(new Set(options.epicKeys.filter(Boolean)));
                        if (epicKeys.length) {
                            params.set('epicKeys', epicKeys.join(','));
                        }
                    }
                    const response = await fetch(`${BACKEND_URL}/api/tasks-with-team-name?${params}`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        cache: 'no-cache',
                        signal: controller.signal
                    });

                    console.log('Response status:', response.status);
                    console.log('Response ok:', response.ok);

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ 
                            error: `HTTP ${response.status}` 
                        }));
                        console.error('Error data:', errorData);
                        throw new Error(errorData.error || `Error ${response.status}`);
                    }

                    const data = await response.json();
                    console.log('Success! Received data:', data);

                    // Sort by priority
                    const sortedTasks = (data.issues || []).sort((a, b) => {
                        const priorityA = priorityOrder[a.fields.priority?.name] || 999;
                        const priorityB = priorityOrder[b.fields.priority?.name] || 999;
                        return priorityA - priorityB;
                    });

                    const filteredTasks = filterTasksForActiveGroup(sortedTasks);
                    const filteredEpicsInScope = activeGroupTeamIds.length
                        ? (data.epicsInScope || []).filter(epic => epic?.teamId && activeGroupTeamSet.has(epic.teamId))
                        : [];
                    const epicKeys = new Set(
                        filteredTasks
                            .map(task => task.fields?.epicKey)
                            .filter(Boolean)
                    );
                    const filteredEpics = {};
                    Object.entries(data.epics || {}).forEach(([key, epic]) => {
                        if (epicKeys.has(key)) {
                            filteredEpics[key] = epic;
                        }
                    });

	                    if (options.updateEpics !== false) {
	                        setEpicDetails(prev => ({ ...prev, ...filteredEpics }));
	                        if (project === 'product') {
	                            setProductEpicsInScope(filteredEpicsInScope);
	                        } else if (project === 'tech') {
	                            setTechEpicsInScope(filteredEpicsInScope);
	                        }
	                    }
	                    if (options.epicsInScopeSetter) {
	                        options.epicsInScopeSetter(filteredEpicsInScope);
	                    }
	                    return filteredTasks;
                } catch (err) {
                    if (err.name === 'AbortError') {
                        return [];
                    }
                    if (setErrors) {
                        const errorMsg = `Failed to load tasks: ${err.message}. Make sure the Python server is running on ${BACKEND_URL}`;
                        setError(errorMsg);
                    }
                    console.error('Full error details:', err);
                    return [];
                } finally {
                    cleanupSprintFetch(controller);
                    if (useLoading) {
                        setLoading(false);
                    }
                }
            };

            const loadProductTasks = async () => {
                const sprintId = selectedSprint;
                setProductTasksLoading(true);
                try {
                    if (activeGroupId && activeGroupTeamIds.length === 0) {
                        setProductTasks([]);
                        setLoadedProductTasks([]);
                        setTasksFetched(true);
                        const current = sprintLoadRef.current;
                        sprintLoadRef.current = {
                            sprintId,
                            product: true,
                            tech: current.sprintId === sprintId ? current.tech : false
                        };
                        if (sprintLoadRef.current.product && sprintLoadRef.current.tech) {
                            lastLoadedSprintRef.current = sprintId;
                        }
                        return;
                    }
                    const data = await fetchTasks('product');
                    setProductTasks(data);
                    setLoadedProductTasks(data);
                    setTasksFetched(true);
                    const current = sprintLoadRef.current;
                    sprintLoadRef.current = {
                        sprintId,
                        product: true,
                        tech: current.sprintId === sprintId ? current.tech : false
                    };
                    if (sprintLoadRef.current.product && sprintLoadRef.current.tech) {
                        lastLoadedSprintRef.current = sprintId;
                    }
                } finally {
                    setProductTasksLoading(false);
                }
            };

            const loadTechTasks = async () => {
                const sprintId = selectedSprint;
                setTechTasksLoading(true);
                try {
                    if (activeGroupId && activeGroupTeamIds.length === 0) {
                        setTechTasks([]);
                        setLoadedTechTasks([]);
                        setTechLoaded(true);
                        setTasksFetched(true);
                        const current = sprintLoadRef.current;
                        sprintLoadRef.current = {
                            sprintId,
                            product: current.sprintId === sprintId ? current.product : false,
                            tech: true
                        };
                        if (sprintLoadRef.current.product && sprintLoadRef.current.tech) {
                            lastLoadedSprintRef.current = sprintId;
                        }
                        return;
                    }
                    const data = await fetchTasks('tech');
                    setTechTasks(data);
                    setLoadedTechTasks(data);
                    setTechLoaded(true);
                    setTasksFetched(true);
                    const current = sprintLoadRef.current;
                    sprintLoadRef.current = {
                        sprintId,
                        product: current.sprintId === sprintId ? current.product : false,
                        tech: true
                    };
                    if (sprintLoadRef.current.product && sprintLoadRef.current.tech) {
                        lastLoadedSprintRef.current = sprintId;
                    }
                } finally {
                    setTechTasksLoading(false);
                }
            };

            const fetchDependencies = async (keys) => {
                if (!keys.length) {
                    setDependencyData({});
                    return;
                }
                const controller = registerSprintFetch();
                try {
                    const response = await fetch(`${BACKEND_URL}/api/dependencies`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ keys }),
                        signal: controller.signal
                    });
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

            const parseScenarioDate = (value) => {
                if (!value) return null;
                // Parse ISO date string (YYYY-MM-DD) as local date at midnight
                // Adding T00:00:00 without timezone creates local date, avoiding timezone day-shift bugs
                // Backend sends dates as date.isoformat() → "2026-01-29"
                // This must parse as local 2026-01-29, not UTC (which could shift to 2026-01-28 in some timezones)
                return new Date(`${value}T00:00:00`);
            };

            const buildScenarioPayload = () => {
                const isActiveSprint = selectedSprintState === 'active';
                const anchorDate = isActiveSprint
                    ? new Date().toISOString().slice(0, 10)
                    : null;
                return {
                    config: {
                        lane_mode: scenarioLaneMode,
                        anchor_date: anchorDate
                    },
                    filters: {
                        sprint: selectedSprint || null,
                        teams: scenarioTeamIds
                    }
                };
            };

            const runScenario = async () => {
                if (!selectedSprint) {
                    setScenarioError('Select a sprint to build a scenario.');
                    return;
                }
                if (isCompletedSprintSelected) {
                    setScenarioError('Scenario planner is disabled for completed sprints.');
                    return;
                }
                setScenarioLoading(true);
                setScenarioError('');
                const controller = registerSprintFetch();
                try {
                    const response = await fetch(`${BACKEND_URL}/api/scenario`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildScenarioPayload()),
                        signal: controller.signal
                    });
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `Scenario error ${response.status}`);
                    }
                    const data = await response.json();
                    setScenarioData(data);
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

            const loadReadyToCloseProductTasks = async () => {
                if (activeGroupId && activeGroupTeamIds.length === 0) {
                    setReadyToCloseProductTasks([]);
                    setReadyToCloseProductEpicsInScope([]);
                    return;
                }
                const epicKeys = Array.from(new Set(
                    (loadedProductTasks || [])
                        .map(task => task.fields?.epicKey)
                        .filter(Boolean)
                ));
                if (!epicKeys.length) {
                    setReadyToCloseProductTasks([]);
                    setReadyToCloseProductEpicsInScope([]);
                    return;
                }
                const data = await fetchTasks('product', {
                    sprintOverride: '',
                    purpose: 'ready-to-close',
                    epicKeys,
                    updateEpics: false,
                    epicsInScopeSetter: setReadyToCloseProductEpicsInScope,
                    useLoading: false,
                    setErrorOnFailure: false
                });
                setReadyToCloseProductTasks(data);
            };

            const loadReadyToCloseTechTasks = async () => {
                if (activeGroupId && activeGroupTeamIds.length === 0) {
                    setReadyToCloseTechTasks([]);
                    setReadyToCloseTechEpicsInScope([]);
                    return;
                }
                const epicKeys = Array.from(new Set(
                    (loadedTechTasks || [])
                        .map(task => task.fields?.epicKey)
                        .filter(Boolean)
                ));
                if (!epicKeys.length) {
                    setReadyToCloseTechTasks([]);
                    setReadyToCloseTechEpicsInScope([]);
                    return;
                }
                const data = await fetchTasks('tech', {
                    sprintOverride: '',
                    purpose: 'ready-to-close',
                    epicKeys,
                    updateEpics: false,
                    epicsInScopeSetter: setReadyToCloseTechEpicsInScope,
                    useLoading: false,
                    setErrorOnFailure: false
                });
                setReadyToCloseTechTasks(data);
            };


            useEffect(() => {
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
            }, [activeGroupId, activeGroupTeamIds.join('|'), selectedSprint, groupsLoading, tasksFetched, productTasksLoading, techTasksLoading]);


            const formatPercent = (value) => `${(value * 100).toFixed(2)}%`;

            const priorityWeights = {
                blocker: 0.4,
                critical: 0.3,
                major: 0.2,
                minor: 0.06,
                low: 0.03,
                trivial: 0.01
            };

            const priorityAliases = {
                highest: 'blocker',
                high: 'major',
                medium: 'minor',
                lowest: 'trivial'
            };

            const normalizePriority = (name) => {
                const key = String(name || '').toLowerCase().trim();
                return priorityAliases[key] || key;
            };

            const getPriorityLabel = (name) => {
                const key = normalizePriority(name);
                return priorityLabelByKey[key] || name;
            };

            const computePriorityWeighted = (priorities) => {
                const totals = { done: 0, incomplete: 0, killed: 0 };
                Object.entries(priorities || {}).forEach(([priorityName, counts]) => {
                    const normalized = normalizePriority(priorityName);
                    const weight = priorityWeights[normalized] || 0;
                    totals.done += weight * (counts.done || 0);
                    totals.incomplete += weight * (counts.incomplete || 0);
                    totals.killed += weight * (counts.killed || 0);
                });
                return totals;
            };

            const computeRate = (metrics) => {
                const done = metrics.done || 0;
                const incomplete = metrics.incomplete || 0;
                const denom = done + incomplete;
                return denom > 0 ? done / denom : 0;
            };

            const getRateClass = (rate) => {
                if (rate >= 1) return 'good';
                if (rate >= 0.6 && rate < 0.8) return 'warn';
                if (rate < 0.6) return 'bad';
                return '';
            };

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

            const buildRadarPoints = ({ values, radius, center, maxValue, axes }) => {
                const count = axes.length;
                return axes.map((axis, index) => {
                    const value = Math.max(0, values[axis] || 0);
                    const ratio = maxValue > 0 ? value / maxValue : 0;
                    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
                    const r = ratio * radius;
                    const x = center + r * Math.cos(angle);
                    const y = center + r * Math.sin(angle);
                    return `${x.toFixed(2)},${y.toFixed(2)}`;
                }).join(' ');
            };

            const buildLocalStatsFromTasks = (taskList, excludedSet) => {
                const teams = {};
                const projectsSummary = {
                    product: { done: 0, incomplete: 0, killed: 0, priorities: {} },
                    tech: { done: 0, incomplete: 0, killed: 0, priorities: {} }
                };
                const totals = { done: 0, incomplete: 0, killed: 0 };
                const storyPointsTotals = { total: 0, done: 0, incomplete: 0, killed: 0 };

                const bumpPriority = (target, priorityName, bucket) => {
                    if (!target.priorities) target.priorities = {};
                    if (!target.priorities[priorityName]) {
                        target.priorities[priorityName] = { done: 0, incomplete: 0, killed: 0 };
                    }
                    target.priorities[priorityName][bucket] += 1;
                };

                const bumpPriorityPoints = (target, priorityName, points) => {
                    if (!target.priorityPoints) target.priorityPoints = {};
                    if (!target.priorityPoints[priorityName]) {
                        target.priorityPoints[priorityName] = 0;
                    }
                    target.priorityPoints[priorityName] += points;
                };

                (taskList || []).forEach(task => {
                    const epicKey = task.fields?.epicKey || 'NO_EPIC';
                    if (excludedSet?.has(epicKey)) {
                        return;
                    }
                    const status = normalizeStatus(task.fields?.status?.name);
                    const isKilled = status === 'killed';
                    const isDone = status === 'done';
                    const priorityName = task.fields?.priority?.name || 'Unspecified';
                    const pointsRaw = task.fields?.customfield_10004;
                    const pointsValue = Number(pointsRaw);
                    const storyPoints = Number.isFinite(pointsValue) ? pointsValue : 0;
                    storyPointsTotals.total += storyPoints;
                    const teamInfo = getTeamInfo(task);
                    const teamKey = teamInfo.id || teamInfo.name || 'unknown';
                    const projectBucket = techProjectKeys.has(task.fields?.projectKey || String(task.key || '').split('-')[0]) ? 'tech' : 'product';

                    if (!teams[teamKey]) {
                        teams[teamKey] = {
                            id: teamInfo.id || teamKey,
                            name: teamInfo.name || teamKey,
                            done: 0,
                            incomplete: 0,
                            killed: 0,
                            priorities: {},
                            priorityPoints: {},
                            projects: {
                                product: { done: 0, incomplete: 0, killed: 0, priorities: {} },
                                tech: { done: 0, incomplete: 0, killed: 0, priorities: {} }
                            }
                        };
                    }

                    const teamEntry = teams[teamKey];
                    if (isKilled) {
                        teamEntry.killed += 1;
                        teamEntry.projects[projectBucket].killed += 1;
                        projectsSummary[projectBucket].killed += 1;
                        totals.killed += 1;
                        storyPointsTotals.killed += storyPoints;
                        bumpPriority(teamEntry, priorityName, 'killed');
                        bumpPriority(teamEntry.projects[projectBucket], priorityName, 'killed');
                        bumpPriority(projectsSummary[projectBucket], priorityName, 'killed');
                        return;
                    }

                    bumpPriorityPoints(teamEntry, priorityName, storyPoints);
                    if (isDone) {
                        teamEntry.done += 1;
                        teamEntry.projects[projectBucket].done += 1;
                        projectsSummary[projectBucket].done += 1;
                        totals.done += 1;
                        storyPointsTotals.done += storyPoints;
                        bumpPriority(teamEntry, priorityName, 'done');
                        bumpPriority(teamEntry.projects[projectBucket], priorityName, 'done');
                        bumpPriority(projectsSummary[projectBucket], priorityName, 'done');
                        return;
                    }

                    teamEntry.incomplete += 1;
                    teamEntry.projects[projectBucket].incomplete += 1;
                    projectsSummary[projectBucket].incomplete += 1;
                    totals.incomplete += 1;
                    storyPointsTotals.incomplete += storyPoints;
                    bumpPriority(teamEntry, priorityName, 'incomplete');
                    bumpPriority(teamEntry.projects[projectBucket], priorityName, 'incomplete');
                    bumpPriority(projectsSummary[projectBucket], priorityName, 'incomplete');
                });

                const sortedTeams = Object.values(teams).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                return {
                    sprint: selectedSprintInfo?.name || '',
                    totals,
                    storyPoints: storyPointsTotals,
                    projects: projectsSummary,
                    teams: sortedTeams
                };
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
                if (!activeGroupId) return;
                if (groupsLoading) return;
                if (!activeGroupTeamIds.length) {
                    if (!selectedTeams.includes('all')) {
                        setSelectedTeams(['all']);
                    }
                    return;
                }
                setSelectedTeams(prev => {
                    const normalized = normalizeSelectedTeams(prev);
                    if (normalized.includes('all')) return ['all'];
                    const filtered = normalized.filter(id => activeGroupTeamSet.has(id));
                    if (!filtered.length) return ['all'];
                    if (filtered.length === normalized.length && filtered.every((id, idx) => id === normalized[idx])) {
                        return prev;
                    }
                    return filtered;
                });
            }, [activeGroupId, activeGroupTeamIds.join('|'), groupsLoading]);

            const selectedTeamsLabel = React.useMemo(() => {
                if (isAllTeamsSelected) return 'All Teams';
                if (selectedTeamSet.size === 1) {
                    const id = Array.from(selectedTeamSet)[0];
                    return teamNameById.get(id) || '1 Team';
                }
                return `${selectedTeamSet.size} Teams`;
            }, [isAllTeamsSelected, selectedTeamSet, teamNameById]);

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

            const excludedEpicSet = React.useMemo(() => new Set(excludedStatsEpics || []), [excludedStatsEpics]);
            const statsTaskList = React.useMemo(() => {
                if (!capacityTasks.length) return [];
                return capacityTasks.filter(task => {
                    const epicKey = task.fields?.epicKey || 'NO_EPIC';
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
                const result = buildLocalStatsFromTasks(statsTaskList, new Set());
                if (perfEnabled) {
                    performance.mark('localStatsBuild:end');
                    performance.measure('localStatsBuild', 'localStatsBuild:start', 'localStatsBuild:end');
                    performance.clearMarks('localStatsBuild:start');
                    performance.clearMarks('localStatsBuild:end');
                    performance.clearMeasures('localStatsBuild');
                }
                return result;
            }, [statsTaskList, selectedSprintInfo?.name, showStats, perfEnabled]);

            const effectiveStatsData = localStatsData;
            const scenarioRawIssues = scenarioData?.issues || EMPTY_ARRAY;
            const scenarioConfig = scenarioData?.config || EMPTY_OBJECT;
            const scenarioSummary = scenarioData?.summary || EMPTY_OBJECT;
            const scenarioBaseUrl = scenarioData?.jira_base_url || jiraUrl || '';
            const scenarioDependencies = scenarioData?.dependencies || EMPTY_ARRAY;
            const scenarioCapacityByTeam = scenarioData?.capacity_by_team || EMPTY_OBJECT;

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
            const scenarioSearchQuery = React.useMemo(
                () => (searchQuery || '').trim().toLowerCase(),
                [searchQuery]
            );
            const scenarioSearchMatchSet = React.useMemo(() => {
                const matches = new Set();
                if (!scenarioSearchQuery || !scenarioIssues || scenarioIssues.length === 0) return matches;
                scenarioIssues.forEach(issue => {
                    if (issue?.key && matchesScenarioSearch(issue, scenarioSearchQuery)) {
                        matches.add(issue.key);
                    }
                });
                return matches;
            }, [scenarioIssues, scenarioSearchQuery]);
            const scenarioFilteredIssues = React.useMemo(() => {
                if (!scenarioSearchQuery) return scenarioIssues;
                return scenarioIssues.filter(issue => scenarioSearchMatchSet.has(issue.key));
            }, [scenarioIssues, scenarioSearchQuery, scenarioSearchMatchSet]);
            const scenarioExcludedIssueKeys = React.useMemo(() => {
                const keys = new Set();
                if (!scenarioIssues || scenarioIssues.length === 0) return keys;
                scenarioIssues.forEach(issue => {
                    if (excludedEpicSet.has(issue?.epicKey || '')) {
                        keys.add(issue.key);
                    }
                });
                return keys;
            }, [scenarioIssues, excludedEpicSet]);
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
                if (!scenarioIssues || scenarioIssues.length === 0) return map;
                scenarioIssues.forEach(issue => {
                    if (issue?.key) {
                        map.set(issue.key, issue);
                    }
                });
                return map;
            }, [scenarioIssues]);
            const scenarioBaseStart = parseScenarioDate(scenarioConfig.start_date);
            const scenarioDeadline = parseScenarioDate(scenarioConfig.quarter_end_date);
            const scenarioBaseEnd = React.useMemo(() => {
                if (!scenarioDeadline) return null;
                if (!scenarioIssues || scenarioIssues.length === 0) return scenarioDeadline;
                let latest = scenarioDeadline;
                scenarioIssues.forEach(issue => {
                    if (!issue.end) return;
                    const end = parseScenarioDate(issue.end);
                    if (end && end > latest) {
                        latest = end;
                    }
                });
                return latest;
            }, [scenarioDeadline, scenarioIssues]);
            const scenarioViewStart = scenarioRangeOverride?.start || scenarioBaseStart;
            const scenarioViewEnd = scenarioRangeOverride?.end || scenarioBaseEnd;
            const scenarioFocusEpicKey = scenarioEpicFocus?.key || null;
            const scenarioFocusIssueKeys = React.useMemo(() => {
                const keys = new Set();
                if (!scenarioFocusEpicKey || !scenarioIssues || scenarioIssues.length === 0) return keys;
                scenarioIssues.forEach(issue => {
                    if (issue.epicKey === scenarioFocusEpicKey && issue.key) {
                        keys.add(issue.key);
                    }
                });
                return keys;
            }, [scenarioIssues, scenarioFocusEpicKey]);
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
                const source = scenarioEpicFocus ? scenarioIssues : scenarioFilteredIssues;
                if (!scenarioEpicFocus) return source;
                return source.filter(issue =>
                    scenarioFocusIssueKeys.has(issue.key) || scenarioFocusContextKeys.has(issue.key)
                );
            }, [scenarioIssues, scenarioFilteredIssues, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioFocusContextKeys]);
            const scenarioTimelineIssueKeys = React.useMemo(() => {
                return new Set(scenarioTimelineIssues.map(issue => issue.key));
            }, [scenarioTimelineIssues]);
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
                    const isExcluded = excludedEpicSet.has(issue.epicKey || '');
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
                const groups = new Map();
                if (!scenarioTimelineIssues || scenarioTimelineIssues.length === 0) return groups;
                scenarioTimelineIssues.forEach(issue => {
                    const lane = scenarioLaneForIssue(issue);
                    if (!groups.has(lane)) {
                        groups.set(lane, []);
                    }
                    groups.get(lane).push(issue);
                });
                groups.forEach(list => {
                    list.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
                });
                return groups;
            }, [scenarioTimelineIssues, scenarioLaneMode, scenarioEpicFocus]);
            const scenarioHasAssignees = React.useMemo(() => {
                if (!scenarioIssues || scenarioIssues.length === 0) return false;
                return scenarioIssues.some(issue => issue.assignee);
            }, [scenarioIssues]);
            const scenarioUnschedulable = React.useMemo(() => {
                if (!scenarioIssues || scenarioIssues.length === 0) return [];
                return scenarioIssues.filter(issue => !issue.start || !issue.end);
            }, [scenarioIssues]);
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
            const SCENARIO_BAR_HEIGHT = 32;
            const SCENARIO_BAR_GAP = 10;
            const SCENARIO_COLLAPSED_ROWS = 2;
            const SCENARIO_TEAM_LEAD_ROWS = 1;
            const scenarioBarGap = scenarioEpicFocus ? 16 : SCENARIO_BAR_GAP;
            const scenarioLaneStacking = React.useMemo(() => {
                // Early return if no lanes to process
                if (!scenarioLanes || scenarioLanes.length === 0) {
                    return {
                        rowIndexByKey: new Map(),
                        laneRowCounts: new Map(),
                        laneVisibleRows: new Map(),
                        laneHiddenCounts: new Map()
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
                        const normalizedEnd = end < start
                            ? start
                            : (isUnscheduled ? new Date(start.getTime() + DAY_MS) : end);

                        // Find a row where:
                        // 1. Time is available (start >= rowEnd)
                        // 2. Row either has no assignee yet, OR has the same assignee
                        let rowIndex = rowEnds.findIndex((rowEnd, idx) => {
                            const timeAvailable = isUnscheduled ? start > rowEnd : start >= rowEnd;
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
                    const excludedIssues = [];
                    issues.forEach((issue) => {
                        if (!issue?.key) return;
                        if (scenarioExcludedIssueKeys.has(issue.key)) {
                            excludedIssues.push(issue);
                        } else {
                            regularIssues.push(issue);
                        }
                    });
                    assignRows(regularIssues, rowEnds, 0, rowAssignees);
                    assignRows(excludedIssues, rowEnds, 0, rowAssignees, { allowAssigneeMix: true, allowNewRows: false });
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
                return { rowIndexByKey, laneRowCounts, laneVisibleRows, laneHiddenCounts };
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

                scenarioTimelineIssues.forEach((issue) => {
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
                scenarioTimelineIssues,
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
                            isExcluded: excludedEpicSet.has(epicKey)
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
                const focusKeys = scenarioFocusSet.size ? scenarioFocusSet : new Set(scenarioTimelineIssues.map(issue => issue.key));
                if (!scenarioIsSingleTeamFocus && focusKeys.size > 10) return [];
                return scenarioEdgeCandidates.filter(edge => focusKeys.has(edge.from) || focusKeys.has(edge.to));
            }, [scenarioFocusSet, scenarioEdgeCandidates, scenarioTimelineIssues, scenarioIsSingleTeamFocus]);

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

            const buildScenarioTooltipPayload = (summary, key, sp, isExcluded = false, hasConflict = false, assignee = null, conflictingKeys = [], isOutOfSprint = false, isInProgress = false, team = null) => {
                const cleanedSummary = normalizeScenarioSummary(summary) || key || '';
                const hasSp = sp !== null && sp !== undefined && sp !== '';
                const spValue = hasSp ? Number(sp) : null;
                let note = '';
                if (isExcluded) {
                    note = 'Excluded (capacity noise)';
                } else if (hasConflict && assignee && conflictingKeys.length > 0) {
                    const taskList = conflictingKeys.slice(0, 3).join(', ');
                    const more = conflictingKeys.length > 3 ? ` +${conflictingKeys.length - 3} more` : '';
                    note = `⚠️ ${assignee} also assigned to: ${taskList}${more}`;
                } else if (hasConflict && assignee) {
                    note = `⚠️ ${assignee} has overlapping tasks`;
                } else if (isOutOfSprint) {
                    note = '🟠 Finishes after quarter end';
                } else if (isInProgress) {
                    note = '🟡 In progress (50% estimated complete)';
                }
                return {
                    summary: cleanedSummary,
                    key: key || '',
                    sp: Number.isFinite(spValue) ? spValue : null,
                    note: note,
                    assignee: assignee || null,
                    team: team || null
                };
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
                if (isCompletedSprintSelected && showPlanning) {
                    setShowPlanning(false);
                }
            }, [isCompletedSprintSelected, showPlanning]);

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

                    // Filter by Done status
                    if (!showDone && task.fields.status?.name === 'Done') {
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
                const weighted = computePriorityWeighted(scoped.priorities);
                const weightedProduct = computePriorityWeighted(scopedProduct.priorities);
                const weightedTech = computePriorityWeighted(scopedTech.priorities);
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

            const epicGroups = React.useMemo(() => {
                return Object.values(groupTasksByEpic(visibleTasks))
                    .sort((a, b) => (epicOrderRef.current[a.key] ?? 999999) - (epicOrderRef.current[b.key] ?? 999999));
            }, [visibleTasks, epicDetails]);

            useEffect(() => {
                const computeStickyEpicFocus = () => {
                    stickyEpicFrameRef.current = null;
                    const stickyTop = Math.max(0, Number(planningOffset) || 0);
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
            }, [epicGroups, planningOffset]);

            const dependencyTasks = React.useMemo(
                () => [...loadedProductTasks, ...loadedTechTasks],
                [loadedProductTasks, loadedTechTasks]
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
                if (selectedSprint !== null && lastLoadedSprintRef.current !== selectedSprint) {
                    return;
                }
                if (!tasksFetched) {
                    return;
                }
                if (productTasksLoading || techTasksLoading) {
                    return;
                }
                if (!dependencyKeySignature) {
                    setDependencyData({});
                    return;
                }
                const keys = dependencyKeySignature.split('|').filter(Boolean);
                fetchDependencies(keys);
            }, [showDependencies, showBlockedAlert, dependencyKeySignature, selectedSprint, tasksFetched, productTasksLoading, techTasksLoading]);

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
            const isAcceptedIncluded = acceptedTasks.length > 0 &&
                acceptedTasks.every(task => selectedTasks[task.key]);
            const isTodoIncluded = todoPendingTasks.length > 0 &&
                todoPendingTasks.every(task => selectedTasks[task.key]);

            const selectedPlanningTasksList = React.useMemo(() => {
                if (!showPlanning) return [];
                return selectedTasksList.filter(task => {
                    const epicKey = task.fields?.epicKey || 'NO_EPIC';
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
                    const epicKey = task.fields?.epicKey || 'NO_EPIC';
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
                    const epicKey = task.fields?.epicKey || 'NO_EPIC';
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
                    if (!excludedEpicSet.has(epic.key)) return false;
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

            const formatPriorityShort = (value) => {
                const name = String(value || '').toLowerCase();
                if (!name) return 'NONE';
                if (name.includes('blocker')) return 'BLKR';
                if (name.includes('critical')) return 'CRIT';
                if (name.includes('highest')) return 'HIGH';
                if (name.includes('high')) return 'HIGH';
                if (name.includes('major')) return 'MAJR';
                if (name.includes('medium')) return 'MED';
                if (name.includes('minor')) return 'MIN';
                if (name.includes('lowest')) return 'LOW';
                if (name.includes('low')) return 'LOW';
                return name.slice(0, 4).toUpperCase();
            };

            const renderPriorityIcon = (priority, idSeed) => {
                const name = String(priority || '').toLowerCase();
                const label = priority || 'None';
                const iconClass = name.replace(/\s+/g, '-') || 'none';
                const safeId = String(idSeed || 'priority').replace(/[^a-z0-9_-]/gi, '') || 'priority';
                const gradientId = `priority-grad-${safeId}`;
                if (!name) {
                    return (
                        <span className="task-priority-icon none" data-priority="None" aria-label="None">
                            <svg viewBox="0 0 16 16">
                                <circle cx="8" cy="8" r="5" fill="none" stroke="#7a8699" strokeWidth="2"/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('blocker')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} data-priority={label} aria-label={label}>
                            <svg viewBox="0 0 16 16">
                                <path d="M8 15c-3.9 0-7-3.1-7-7s3.1-7 7-7 7 3.1 7 7-3.1 7-7 7zM4 7c-.6 0-1 .4-1 1s.4 1 1 1h8c.6 0 1-.4 1-1s-.4-1-1-1H4z" fill="#ff5630"/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('critical')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} data-priority={label} aria-label={label}>
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
                        <span className={`task-priority-icon ${iconClass}`} data-priority={label} aria-label={label}>
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
                        <span className={`task-priority-icon ${iconClass}`} data-priority={label} aria-label={label}>
                            <svg viewBox="0 0 16 16">
                                <circle cx="8" cy="8" r="5" fill="none" stroke="#7a8699" strokeWidth="2"/>
                            </svg>
                        </span>
                    );
                }
                if (name.includes('minor') || name.includes('lowest')) {
                    return (
                        <span className={`task-priority-icon ${iconClass}`} data-priority={label} aria-label={label}>
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
                        <span className={`task-priority-icon ${iconClass}`} data-priority={label} aria-label={label}>
                            <svg viewBox="0 0 16 16">
                                <path d="M12.5 6.1c.5-.3 1.1-.1 1.4.4.3.5.1 1.1-.3 1.3l-5 3c-.3.2-.7.2-1 0l-5-3c-.6-.2-.7-.9-.4-1.3.2-.5.9-.7 1.3-.4L8 8.8l4.5-2.7z" fill="#0065ff"/>
                            </svg>
                        </span>
                    );
                }
                return (
                    <span className={`task-priority-icon ${iconClass}`} data-priority={label} aria-label={label}>
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
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['Postponed'] });
            };

            const buildTodoPendingLink = ({ teamId, teamIds, projectName, projectNames }) => {
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['To Do', 'Pending'] });
            };

            const buildAcceptedLink = ({ teamId, teamIds, projectName, projectNames }) => {
                return buildTeamStatusLink({ teamId, teamIds, projectName, projectNames, statuses: ['Accepted'] });
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
            const getTaskSprintTokens = (task) => {
                const tokens = [];
                const pushToken = (value) => {
                    if (value === null || value === undefined) return;
                    const str = String(value).trim();
                    if (!str) return;
                    tokens.push(str);
                };
                pushToken(task?.sprintId);
                pushToken(task?.sprintName);
                pushToken(task?.fields?.sprintId);
                pushToken(task?.fields?.sprintName);
                if (task?.fields?.sprint && typeof task.fields.sprint === 'object') {
                    pushToken(task.fields.sprint.id);
                    pushToken(task.fields.sprint.name);
                }
                const sprintField = task?.fields?.customfield_10101;
                if (!sprintField) return tokens;
                if (Array.isArray(sprintField)) {
                    sprintField.forEach((entry) => {
                        if (entry && typeof entry === 'object') {
                            pushToken(entry.id);
                            pushToken(entry.name);
                        } else {
                            pushToken(entry);
                        }
                    });
                } else if (typeof sprintField === 'object') {
                    pushToken(sprintField.id);
                    pushToken(sprintField.name);
                } else if (typeof sprintField === 'string') {
                    pushToken(sprintField);
                    const match = sprintField.match(/id=([0-9]+)/);
                    if (match) {
                        pushToken(match[1]);
                    }
                } else {
                    pushToken(sprintField);
                }
                return tokens;
            };
            const isTaskInSelectedSprint = (task) => {
                if (!selectedSprint) return false;
                const tokens = getTaskSprintTokens(task);
                if (!tokens.length) return false;
                const selectedId = String(selectedSprint);
                const selectedName = selectedSprintInfo?.name ? String(selectedSprintInfo.name) : '';
                if (tokens.includes(selectedId)) return true;
                if (selectedName && tokens.includes(selectedName)) return true;
                return false;
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
            const matchesSelectedSprint = (epic) => {
                const epicSprintId = epic.sprintId || epic.sprint?.id || epic.fields?.sprint?.id || '';
                const epicSprintName = epic.sprintName || epic.sprint?.name || epic.fields?.sprint?.name || '';
                if (epicSprintId) {
                    return String(epicSprintId) === String(selectedSprint || '');
                }
                if (epicSprintName) {
                    const selectedName = selectedSprintInfo?.name || '';
                    const normalizedEpic = String(epicSprintName).trim().toLowerCase();
                    const normalizedSelected = String(selectedName).trim().toLowerCase();
                    if (normalizedEpic && normalizedSelected) {
                        if (normalizedEpic === normalizedSelected) return true;
                        if (normalizedEpic.includes(normalizedSelected)) return true;
                        if (normalizedSelected.includes(normalizedEpic)) return true;
                    }
                    return epicSprintName === selectedSprintInfo?.name;
                }
                return false;
            };
            const epicHasStoryInSelectedSprint = (epicStories) => {
                if (!epicStories || epicStories.length === 0) return false;
                return epicStories.some(task => isTaskInSelectedSprint(task));
            };
            const epicMatchesSelectedSprint = (epic, epicStories) => {
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
                    if (!epicMatchesSelectedSprint(epic, epicStories)) return false;
                    return epicStories.every(task => readyToCloseStoryStatuses.has(normalizeStatus(task.fields.status?.name)));
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
                    const epicStories = readyToCloseTasks.filter(task => {
                        if (!task.fields?.epicKey) return false;
                        if (task.fields.epicKey !== epic.key) return false;
                        if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                        return true;
                    });
                    if (epicStories.length === 0) return false;
                    // readyToCloseTasks are loaded only for epics referenced by current-sprint tasks
                    // (scoped via `epicKeys`), so selected-sprint matching is already implied here.
                    return epicStories.every(task => readyToCloseStoryStatuses.has(normalizeStatus(task.fields.status?.name)));
                });
            }, [
                analysisEpicsSource,
                dismissedAlertSet,
                isAllTeamsSelected,
                selectedTeamSet,
                tasks,
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
                const futureRoutedEpicKeys = new Set(futureRoutedEpics.map(epic => epic.key).filter(Boolean));
                return emptyEpics.filter(epic => {
                    if (!epic?.key) return false;
                    if (Number(epic.selectedActionableStories || 0) > 0) return false;
                    if (epicsWithActionableStoriesInSelectedSprint.has(epic.key)) return false;
                    if (futureRoutedEpicKeys.has(epic.key)) return false;
                    return true;
                });
            }, [emptyEpics, epicsWithActionableStoriesInSelectedSprint, futureRoutedEpics]);
            const emptyEpicTeams = groupAlertsByTeam(emptyEpicsForAlert, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));

            const waitingForStoriesEpics = React.useMemo(() => {
                const seen = new Set();
                const merged = [...analysisWaitingEpics, ...postponedEmptyEpics].filter(epic => {
                    if (!epic?.key) return false;
                    if (seen.has(epic.key)) return false;
                    seen.add(epic.key);
                    return true;
                });
                return merged;
            }, [analysisWaitingEpics, postponedEmptyEpics]);

            const analysisEpicTeams = groupAlertsByTeam(waitingForStoriesEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));

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
                waiting: waitingForStoriesEpics.length,
                empty: emptyEpicsForAlert.length,
                done: doneStoryEpics.length
            };
            const alertItemCount = alertCounts.missing + alertCounts.blocked + alertCounts.followup + alertCounts.waiting + alertCounts.empty + alertCounts.done;

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
                    setIsPlanningStuck(rect.top <= 0);
                };
                check();
                window.addEventListener('scroll', check, { passive: true });
                return () => window.removeEventListener('scroll', check);
            }, [showPlanning]);

            const openSelectedInJira = () => {
                if (!jiraUrl) return;
                const keys = capacityTasks
                    .filter(task => selectedTasks[task.key])
                    .map(task => task.key)
                    .sort();
                if (keys.length === 0) return;
                const jql = encodeURIComponent(`key in (${keys.join(', ')})`);
                window.open(`${jiraUrl}/issues/?jql=${jql}`, '_blank', 'noopener,noreferrer');
            };

            return (
                <div className="container" style={{ '--planning-offset': `${planningOffset}px` }}>
                    <header>
                        <div className="subtitle">
                            <span className="subtitle-main">
                                <img src="epm-burst.svg" alt="" className="subtitle-logo" aria-hidden="true" />
                                Jira Execution Planner
                                <span className="subtitle-secondary"> · Product &amp; Tech Projects</span>
                                {updateNoticeVisible && (
                                    <button
                                        type="button"
                                        className="update-badge"
                                        onClick={() => setShowUpdateModal(true)}
                                        title="A new version is available"
                                    >
                                        New version available
                                    </button>
                                )}
                            </span>
                            <div className="header-actions">
                                <div className="header-actions-row">
                                    <div className="control-field control-search" data-label="Search">
                                        <span className="control-label">Search</span>
                                        <div className="search-wrap">
                                            <input
                                                type="text"
                                                className="search-input"
                                                placeholder="Search tickets..."
                                                value={searchInput}
                                                onChange={(e) => setSearchInput(e.target.value)}
                                                ref={searchInputRef}
                                            />
                                            {searchInput && (
                                                <button
                                                    className="search-clear"
                                                    onClick={() => setSearchInput('')}
                                                    title="Clear search"
                                                    aria-label="Clear search"
                                                >
                                                    ×
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        className="secondary compact refresh-icon"
                                        onClick={() => {
                                            loadProductTasks();
                                            loadTechTasks();
                                            loadReadyToCloseProductTasks();
                                            loadReadyToCloseTechTasks();
                                        }}
                                        disabled={loading || selectedSprint === null}
                                        title="Refresh tasks from Jira"
                                        aria-label="Refresh tasks from Jira"
                                        type="button"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="M19 7.5a7.5 7.5 0 1 0 2 5.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
                                            <path d="M19 3v4h-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="view-selector">
                            <div className="controls-label">Controls</div>
                            <div className="view-filters">
                                <div className="control-field" data-label="Sprint">
                                    <span className="control-label">Sprint</span>
                                    <div className="sprint-dropdown" ref={sprintDropdownRef}>
                                        <div
                                            className={`sprint-dropdown-toggle ${showSprintDropdown ? 'open' : ''}`}
                                            role="button"
                                            aria-label="Select sprint"
                                            tabIndex={sprintsLoading || availableSprints.length === 0 ? -1 : 0}
                                        onClick={() => {
                                            if (sprintsLoading || availableSprints.length === 0) return;
                                            setShowSprintDropdown(!showSprintDropdown);
                                        }}
                                        onKeyDown={(event) => {
                                            if (sprintsLoading || availableSprints.length === 0) return;
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setShowSprintDropdown(!showSprintDropdown);
                                            }
                                        }}
                                        aria-disabled={sprintsLoading || availableSprints.length === 0}
                                    >
                                        <span>{sprintName || 'Sprint'}</span>
                                        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                            <path d="M6 9L1 4h10z"/>
                                        </svg>
                                    </div>
                                    {showSprintDropdown && (
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
                                </div>
                                {((groupsConfig.groups || []).length > 1) && (
                                    <div className="group-control">
                                        <div className="control-field" data-label="Group">
                                            <span className="control-label">Group</span>
                                            <div className="group-dropdown" ref={groupDropdownRef}>
                                            <div
                                                className={`group-dropdown-toggle ${showGroupDropdown ? 'open' : ''}`}
                                                role="button"
                                                aria-label="Select group"
                                                tabIndex={groupsLoading ? -1 : 0}
                                                onClick={() => {
                                                    if (groupsLoading) return;
                                                    setShowGroupDropdown(!showGroupDropdown);
                                                }}
                                                onKeyDown={(event) => {
                                                    if (groupsLoading) return;
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        setShowGroupDropdown(!showGroupDropdown);
                                                    }
                                                }}
                                                aria-disabled={groupsLoading}
                                            >
                                                <span>{activeGroup?.name || (groupsLoading ? 'Loading...' : 'Group')}</span>
                                                <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                                    <path d="M6 9L1 4h10z"/>
                                                </svg>
                                            </div>
                                            {showGroupDropdown && (
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
                                        </div>
                                    </div>
                                )}
                                <div className="control-field" data-label="Teams">
                                    <span className="control-label">Teams</span>
                                    <div className="team-dropdown" ref={teamDropdownRef}>
                                    <div
                                        className={`team-dropdown-toggle ${showTeamDropdown ? 'open' : ''}`}
                                        role="button"
                                        aria-label="Filter teams"
                                        tabIndex={tasks.length === 0 && loading ? -1 : 0}
                                        onClick={() => {
                                            if (tasks.length === 0 && loading) return;
                                            setShowTeamDropdown(!showTeamDropdown);
                                        }}
                                        onKeyDown={(event) => {
                                            if (tasks.length === 0 && loading) return;
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setShowTeamDropdown(!showTeamDropdown);
                                            }
                                        }}
                                        aria-disabled={tasks.length === 0 && loading}
                                    >
                                        <span>{selectedTeamsLabel}</span>
                                        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                                            <path d="M6 9L1 4h10z"/>
                                        </svg>
                                    </div>
                                    {showTeamDropdown && (
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
                                </div>
                                <div className="mode-switch">
                                    <button
                                        className={`mode-switch-button ${(!showPlanning && !showStats && !showScenario) ? 'active' : ''}`}
                                        onClick={() => {
                                            setShowPlanning(false);
                                            setShowStats(false);
                                            setShowScenario(false);
                                        }}
                                        title="Return to default state"
                                        type="button"
                                    >
                                        Catch Up
                                    </button>
                                    <button
                                        className={`mode-switch-button ${showPlanning ? 'active' : ''}`}
                                        onClick={() => setShowPlanning(!showPlanning)}
                                        disabled={isCompletedSprintSelected}
                                        title="Toggle sprint planning panel"
                                    >
                                        Planning
                                    </button>
                                    <button
                                        className={`mode-switch-button ${showStats ? 'active' : ''}`}
                                        onClick={() => setShowStats(!showStats)}
                                        title="Toggle sprint statistics"
                                        disabled={isFutureSprintSelected}
                                    >
                                        Statistics
                                    </button>
                                    <button
                                        className={`mode-switch-button ${showScenario ? 'active' : ''}`}
                                        onClick={() => setShowScenario(!showScenario)}
                                        title="Toggle scenario planner"
                                        disabled={!selectedSprint || isCompletedSprintSelected}
                                    >
                                        Scenario
                                    </button>
                                </div>
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
                            </div>
                        </div>
                    </header>

                    {!isCompletedSprintSelected && (
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

                    <div className={`stats-panel ${showStats ? 'open' : ''}`}>
                        <div className="stats-note">
                            Selected sprint: {selectedSprintInfo?.name || 'Sprint'}
                        </div>

                        {showStats && !effectiveStatsData && (
                            <div className="stats-note">Load stats for the selected sprint.</div>
                        )}

                        {effectiveStatsData && (
                            <>
                                <div className="stats-summary">
                                    <div
                                        className={`stats-card selectable ${statsGraphMode === 'absolute' ? 'active' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setStatsGraphMode('absolute')}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setStatsGraphMode('absolute');
                                            }
                                        }}
                                        aria-pressed={statsGraphMode === 'absolute'}
                                    >
                                        <h4>Delivery Rate</h4>
                                        <div className="stat-value">
                                            {formatPercent(computeRate(statsTotals.straight))}
                                        </div>
                                        <div className="stats-note">Absolute rate</div>
                                    </div>
                                    <div
                                        className={`stats-card selectable ${statsGraphMode === 'weighted' ? 'active' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setStatsGraphMode('weighted')}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setStatsGraphMode('weighted');
                                            }
                                        }}
                                        aria-pressed={statsGraphMode === 'weighted'}
                                    >
                                        <h4>Weighted Rate</h4>
                                        <div className="stat-value">
                                            {formatPercent(computeRate(statsTotals.weighted))}
                                        </div>
                                        <div className="stats-note">Priority-weighted</div>
                                    </div>
                                    <div className="stats-card">
                                        <h4>Totals</h4>
                                        <div className="stat-value">{statsTotals.straight.done + statsTotals.straight.incomplete + statsTotals.straight.killed}</div>
                                        <div className="stats-note">
                                            {statsTotals.straight.done} done · {statsTotals.straight.incomplete} incomplete · {statsTotals.straight.killed} killed
                                        </div>
                                    </div>
                                    <div className="stats-card">
                                        <h4>Source</h4>
                                        <div className="stat-value">Sprint tasks</div>
                                        <div className="stats-note">Derived from the loaded sprint list</div>
                                    </div>
                                </div>

                                <div className="stats-view-toggle">
                                    <button
                                        className={`stats-toggle ${statsView === 'teams' ? 'active' : ''}`}
                                        onClick={() => setStatsView('teams')}
                                    >
                                        Teams
                                    </button>
                                    <button
                                        className={`stats-toggle ${statsView === 'priority' ? 'active' : ''}`}
                                        onClick={() => setStatsView('priority')}
                                    >
                                        Priority
                                    </button>
                                </div>

                                <div className={`stats-view ${statsView === 'teams' ? 'open' : ''}`}>
                                    <div className="stats-bars" style={{ '--stats-bar-columns': statsBarColumns }}>
                                        {statsTeamRows.map(team => {
                                            const graphRate = statsGraphMode === 'weighted' ? team.weightedRate : team.straightRate;
                                            return (
                                                <div key={team.id} className="stats-bar">
                                                    <div className="stats-bar-value">{formatPercent(graphRate)}</div>
                                                    <div className="stats-bar-track">
                                                        <div
                                                            className={`stats-bar-fill ${getRateClass(graphRate)}`}
                                                            style={{ height: `${Math.min(100, graphRate * 100)}%` }}
                                                        />
                                                    </div>
                                                    <div className="stats-bar-label">{team.name}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <table className="stats-table">
                                        <thead>
                                            <tr className="stats-group-row">
                                                <th className="dimension"></th>
                                                <th className="stats-col total" colSpan="4">Total</th>
                                                <th className="stats-col product" colSpan="4">Product</th>
                                                <th className="stats-col tech" colSpan="4">Tech</th>
                                            </tr>
                                            <tr>
                                                <th className="dimension">Team</th>
                                                <th className="metric stats-col total">Done</th>
                                                <th className="metric stats-col total">Incomplete</th>
                                                <th className="metric stats-col total">Absolute</th>
                                                <th className="metric stats-col total">Weighted</th>
                                                <th className="metric stats-col product">Done</th>
                                                <th className="metric stats-col product">Incomplete</th>
                                                <th className="metric stats-col product">Absolute</th>
                                                <th className="metric stats-col product">Weighted</th>
                                                <th className="metric stats-col tech">Done</th>
                                                <th className="metric stats-col tech">Incomplete</th>
                                                <th className="metric stats-col tech">Absolute</th>
                                                <th className="metric stats-col tech">Weighted</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {statsTeamRows.map(team => {
                                                const totalDoneLink = buildStatLink(team.straight.done, {
                                                    teamId: team.id,
                                                    projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'],
                                                    statuses: ['Done'],
                                                    issueType: 'Story'
                                                });
                                                const totalIncompleteLink = buildStatLink(team.straight.incomplete, {
                                                    teamId: team.id,
                                                    projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'],
                                                    excludeStatuses: ['Done', 'Killed'],
                                                    issueType: 'Story'
                                                });
                                                const productDoneLink = buildStatLink(team.product.done, {
                                                    teamId: team.id,
                                                    projectName: 'PRODUCT ROADMAPS',
                                                    statuses: ['Done'],
                                                    issueType: 'Story'
                                                });
                                                const productIncompleteLink = buildStatLink(team.product.incomplete, {
                                                    teamId: team.id,
                                                    projectName: 'PRODUCT ROADMAPS',
                                                    excludeStatuses: ['Done', 'Killed'],
                                                    issueType: 'Story'
                                                });
                                                const techDoneLink = buildStatLink(team.tech.done, {
                                                    teamId: team.id,
                                                    projectName: 'TECHNICAL ROADMAP',
                                                    statuses: ['Done'],
                                                    issueType: 'Story'
                                                });
                                                const techIncompleteLink = buildStatLink(team.tech.incomplete, {
                                                    teamId: team.id,
                                                    projectName: 'TECHNICAL ROADMAP',
                                                    excludeStatuses: ['Done', 'Killed'],
                                                    issueType: 'Story'
                                                });

                                                return (
                                                <tr key={team.id}>
                                                    <td className="dimension">{team.name}</td>
                                                    <td className="metric stats-col total">
                                                        <div className="postponed-cell">
                                                            <span>{team.straight.done}</span>
                                                            {totalDoneLink && (
                                                                <a
                                                                    className="stats-link"
                                                                    href={totalDoneLink}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    title="View done stories for this team in Jira"
                                                                    aria-label="Open done stories in Jira"
                                                                >
                                                                    ↗
                                                                </a>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="metric stats-col total">
                                                        <div className="postponed-cell">
                                                            <span>{team.straight.incomplete}</span>
                                                            {totalIncompleteLink && (
                                                                <a
                                                                    className="stats-link"
                                                                    href={totalIncompleteLink}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    title="View incomplete stories for this team in Jira"
                                                                    aria-label="Open incomplete stories in Jira"
                                                                >
                                                                    ↗
                                                                </a>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="metric stats-col total">{formatPercent(team.straightRate)}</td>
                                                    <td className="metric stats-col total">{formatPercent(team.weightedRate)}</td>
                                                    <td className="metric stats-col product">
                                                        <div className="postponed-cell">
                                                            <span>{team.product.done}</span>
                                                            {productDoneLink && (
                                                                <a
                                                                    className="stats-link"
                                                                    href={productDoneLink}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    title="View done product stories for this team in Jira"
                                                                    aria-label="Open done product stories in Jira"
                                                                >
                                                                    ↗
                                                                </a>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="metric stats-col product">
                                                        <div className="postponed-cell">
                                                            <span>{team.product.incomplete}</span>
                                                            {productIncompleteLink && (
                                                                <a
                                                                    className="stats-link"
                                                                    href={productIncompleteLink}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    title="View incomplete product stories for this team in Jira"
                                                                    aria-label="Open incomplete product stories in Jira"
                                                                >
                                                                    ↗
                                                                </a>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="metric stats-col product">{formatPercent(computeRate(team.product))}</td>
                                                    <td className="metric stats-col product">{formatPercent(computeRate(team.weightedProduct))}</td>
                                                    <td className="metric stats-col tech">
                                                        <div className="postponed-cell">
                                                            <span>{team.tech.done}</span>
                                                            {techDoneLink && (
                                                                <a
                                                                    className="stats-link"
                                                                    href={techDoneLink}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    title="View done tech stories for this team in Jira"
                                                                    aria-label="Open done tech stories in Jira"
                                                                >
                                                                    ↗
                                                                </a>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="metric stats-col tech">
                                                        <div className="postponed-cell">
                                                            <span>{team.tech.incomplete}</span>
                                                            {techIncompleteLink && (
                                                                <a
                                                                    className="stats-link"
                                                                    href={techIncompleteLink}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    title="View incomplete tech stories for this team in Jira"
                                                                    aria-label="Open incomplete tech stories in Jira"
                                                                >
                                                                    ↗
                                                                </a>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="metric stats-col tech">{formatPercent(computeRate(team.tech))}</td>
                                                    <td className="metric stats-col tech">{formatPercent(computeRate(team.weightedTech))}</td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className={`stats-view ${statsView === 'priority' ? 'open' : ''}`}>
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
                            </>
                        )}
                    </div>

                    {showScenario && (
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
                                            <div className="scenario-control">
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={scenarioShowConflictsOnly}
                                                        onChange={(e) => setScenarioShowConflictsOnly(e.target.checked)}
                                                        style={{marginRight: '0.4rem'}}
                                                    />
                                                    Show conflicts only
                                                </label>
                                            </div>
                                            <button
                                                className="secondary"
                                                onClick={runScenario}
                                                disabled={scenarioLoading || !selectedSprint}
                                            >
                                                {scenarioLoading ? 'Running...' : 'Run Scenario'}
                                            </button>
                                        </div>
                                    </div>

                                    {scenarioError && <div className="scenario-error">{scenarioError}</div>}
                                    {scenarioLoading && <div className="scenario-loading">Computing scenario timeline...</div>}

                                    {scenarioData && (
                                        <>
                                            <div className="scenario-summary">
                                                {scenarioAssigneeConflicts.conflicts.size > 0 && (
                                                    <div className="scenario-card scenario-card-warning">
                                                        <h4>⚠️ Schedule Warnings</h4>
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
                                                    </div>
                                                )}
                                                <div className="scenario-card">
                                                    <h4>Timeline Status</h4>
                                                    <div className="scenario-value">
                                                        {scenarioDeadlineAtRisk ? 'At risk' : 'On track'}
                                                    </div>
                                                    <div className="scenario-subtitle">
                                                        {scenarioLateItems.length} late · {scenarioCriticalPathItems.length} critical path
                                                    </div>
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
                                                </div>
                                                <div className="scenario-card">
                                                    <h4>Unschedulable</h4>
                                                    <div className="scenario-value">{scenarioUnschedulableItems.length}</div>
                                                    <div className="scenario-subtitle">Missing SP or dependencies</div>
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
                                                </div>
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
                                                            <div className="scenario-lane-track" style={{ height: `${laneHeight}px` }}>
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
                                                                    const issueUrl = scenarioBaseUrl ? `${scenarioBaseUrl}/browse/${issue.key}` : '';
                                                                    const issueSummary = normalizeScenarioSummary(issue.summary) || issue.key;
                                                                    const isExcluded = excludedEpicSet.has(issue.epicKey || '');
                                                                    const hasAssigneeConflict = scenarioAssigneeConflicts.conflicts.has(issue.key);
                                                                    const conflictingKeys = scenarioAssigneeConflicts.conflictDetails.get(issue.key) || [];
                                                                    const issueEndDate = issue.end ? parseScenarioDate(issue.end) : null;
                                                                    const isOutOfSprint = issueEndDate && scenarioViewEnd && issueEndDate > scenarioViewEnd;
                                                                    const isInProgress = issue.progressPct !== null && issue.progressPct !== undefined;
                                                                    const issueTooltip = buildScenarioTooltipPayload(issue.summary || issue.key, issue.key, issue.sp, isExcluded, hasAssigneeConflict, issue.assignee, conflictingKeys, isOutOfSprint, isInProgress, issue.team);
                                                                    const isFocused = scenarioHoverKey === issue.key || scenarioFlashKey === issue.key;
                                                                    const isUpstream = scenarioUpstreamSet.has(issue.key);
                                                                    const isDownstream = scenarioDownstreamSet.has(issue.key);
                                                                    const isDimmed = scenarioHoverKey && !isFocused && !isUpstream && !isDownstream;
                                                                    const isUnscheduled = !issue.start || !issue.end;
                                                                    const isFocusContext = scenarioEpicFocus && scenarioFocusContextKeys.has(issue.key) && !scenarioFocusIssueKeys.has(issue.key);
                                                                    const isSearchMatch = scenarioSearchQuery && scenarioSearchMatchSet.has(issue.key);
                                                                    const isDone = issue.scheduledReason === 'already_done';
                                                                    return (
                                                                        <a
                                                                            key={issue.key}
                                                                            className={`scenario-bar ${isDone ? 'done' : ''} ${issue.isCritical ? 'critical' : ''} ${issue.isLate ? 'late' : ''} ${((issue.blockedBy || []).length > 0 || scenarioBlockedSet.has(issue.key)) ? 'blocked' : ''} ${(issue.isContext || isFocusContext) ? 'context' : ''} ${isUnscheduled ? 'unscheduled' : ''} ${isFocused ? 'is-focused' : ''} ${isUpstream ? 'is-upstream' : ''} ${isDownstream ? 'is-downstream' : ''} ${isDimmed ? 'dimmed' : ''} ${scenarioFlashKey === issue.key ? 'flash' : ''} ${isExcluded ? 'excluded' : ''} ${isSearchMatch ? 'search-match' : ''} ${hasAssigneeConflict ? 'assignee-conflict' : ''} ${isOutOfSprint ? 'out-of-sprint' : ''} ${isInProgress ? 'in-progress' : ''}`}
                                                                            style={{ left, width, height: `${SCENARIO_BAR_HEIGHT}px`, top }}
                                                                            href={issueUrl || '#'}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            ref={registerScenarioIssueRef(issue.key)}
                                                                            onClick={(event) => {
                                                                                event.preventDefault();
                                                                                // Scroll to task in the task list below
                                                                                const taskElement = document.querySelector(`[data-task-key="${issue.key}"]`);
                                                                                if (taskElement) {
                                                                                    const elementTop = taskElement.getBoundingClientRect().top + window.scrollY;
                                                                                    window.scrollTo({ top: elementTop - 100, behavior: 'smooth' });
                                                                                    // Flash highlight the task
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
                                                                        >
                                                                            <div className="scenario-bar-inner">
                                                                                <div className="scenario-bar-summary">{issueSummary}</div>
                                                                            </div>
                                                                        </a>
                                                                    );
                                                                })}
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
                                                            return (
                                                                <path
                                                                    key={path.id}
                                                                    className={`scenario-edge ${path.isActive ? 'active' : ''} ${path.isFaded ? 'faded' : ''} ${path.isContextEdge ? 'context' : ''} ${path.type === 'block' ? 'block' : ''}`}
                                                                    d={path.d}
                                                                    markerEnd={path.type === 'block' ? 'url(#scenario-arrow-block)' : 'url(#scenario-arrow)'}
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

                    <div ref={planningPanelRef} className={`planning-panel ${showPlanning && !isCompletedSprintSelected ? 'open' : ''}${isPlanningStuck ? ' stuck' : ''}`}>
                        {/* --- Planning Actions (top of panel) --- */}
                        <div className="planning-actions">
                            <button
                                className={`planning-action-button ${isAcceptedIncluded ? 'active' : ''}`}
                                onClick={() => toggleIncludeByStatus(['Accepted', 'In Progress'])}
                                disabled={visibleTasks.length === 0}
                                title="Include all Accepted and In Progress stories for the current view"
                            >
                                Include Accepted
                            </button>
                            <button
                                className={`planning-action-button ${isTodoIncluded ? 'active' : ''}`}
                                onClick={() => toggleIncludeByStatus(['To Do', 'Pending'])}
                                disabled={visibleTasks.length === 0}
                                title="Include all To Do / Pending stories for the current view"
                            >
                                Include To Do
                            </button>
                            <button
                                className="uncheck-button"
                                onClick={clearSelectedTasks}
                                disabled={selectedCount === 0}
                                title="Clear all selected tasks"
                            >
                                Uncheck Selected
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
                                    <div className="capacity-bar-footer">
                                        <span
                                            className={`capacity-bar-variance ${capacitySummary.status}`}
                                            data-tooltip={`Selected effort (${selectedSP.toFixed(1)} SP) vs Team capacity (${totalCapacityAdjusted.toFixed(1)} SP). ${capacitySummary.title || ''}`}
                                            onMouseEnter={(e) => e.currentTarget.closest('.capacity-bar-graph').classList.add('highlight-variance')}
                                            onMouseLeave={(e) => e.currentTarget.closest('.capacity-bar-graph').classList.remove('highlight-variance')}
                                        >
                                            {capacitySummary.label || '0%'} variance
                                        </span>
                                        {excludedCapacityAdjusted > 0 && (
                                            <span
                                                className="capacity-bar-excluded-note clickable-number"
                                                data-tooltip={`Capacity reserved for excluded mandatory epics (${excludedCapacityAdjusted.toFixed(1)} SP). Click to scroll to first excluded epic.`}
                                                onClick={() => scrollToFirstExcludedEpic('any')}
                                                onMouseEnter={(e) => e.currentTarget.closest('.capacity-bar-graph').classList.add('highlight-excluded')}
                                                onMouseLeave={(e) => e.currentTarget.closest('.capacity-bar-graph').classList.remove('highlight-excluded')}
                                            >
                                                {excludedCapacityAdjusted.toFixed(1)} SP excluded
                                            </span>
                                        )}
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
                        {selectedTeamEntries.length > 1 && (() => {
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
                            const rows = Math.ceil(teamCount / maxPerRow);
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
                                            const barW = 120;
                                            const barH = 22;
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
                                                    <svg className="microbar" viewBox={`0 0 ${barW} ${barH}`}>
                                                        <rect x="0" y="0" width={barW} height={barH} rx="4" fill="#e0ddd7" />
                                                        <rect x="0" y="0" width={valW} height={barH} rx="4" fill={teamColor} />
                                                        <text x="4" y={barH / 2} dominantBaseline="central" className="microbar-label">{spLabel}</text>
                                                        {markerX !== null && (
                                                            <line x1={markerX} y1="0" x2={markerX} y2={barH} stroke="var(--text-primary)" strokeWidth="1.5" strokeDasharray="3 2" />
                                                        )}
                                                    </svg>
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
                                            style={{ width: `${productPct}%` }}
                                            data-tooltip={`Product: ${productSP.toFixed(1)} SP (${productPct.toFixed(0)}% of selected).${excludedProduct > 0 ? ` Excluded: ${excludedProduct.toFixed(1)} SP.` : ''}`}
                                        >
                                            {productPct > 15 && (
                                                <span className="capacity-bar-fill-label">Product {productPct.toFixed(0)}% · {productSP.toFixed(1)} SP</span>
                                            )}
                                        </div>
                                        {/* Tech fill */}
                                        <div
                                            className="project-bar-fill tech"
                                            style={{ left: `${productPct}%`, width: `${techPct}%` }}
                                            data-tooltip={`Tech: ${techSP.toFixed(1)} SP (${techPct.toFixed(0)}% of selected).${excludedTech > 0 ? ` Excluded: ${excludedTech.toFixed(1)} SP.` : ''}`}
                                        >
                                            {techPct > 15 && (
                                                <span className="capacity-bar-fill-label">Tech {techPct.toFixed(0)}% · {techSP.toFixed(1)} SP</span>
                                            )}
                                        </div>
                                        {/* 70% target marker */}
                                        <div className="capacity-bar-marker" style={{ left: `${targetPct}%` }}>
                                            <div className="capacity-bar-marker-line dashed" />
                                            <div className="capacity-bar-marker-label">Target<br/>{targetPct}% / {100 - targetPct}%</div>
                                        </div>
                                    </div>
                                    <div className="capacity-bar-footer">
                                        {productPct <= 15 && <span style={{ color: '#3d1ef8' }}>Product {productPct.toFixed(0)}% · {productSP.toFixed(1)} SP</span>}
                                        {techPct <= 15 && <span style={{ color: '#FE5000' }}>Tech {techPct.toFixed(0)}% · {techSP.toFixed(1)} SP</span>}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                    {showBackToTop && (
                        <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                            Back to top
                        </button>
                    )}

                    {(productTasksLoading || techTasksLoading) && (
                        <div className="loading-status" style={{
                            padding: '0.5rem 1rem',
                            background: 'rgba(59, 130, 246, 0.08)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '0.5rem',
                            marginBottom: '1rem',
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)'
                        }}>
                            {productTasksLoading && <div>⏳ Loading product tasks...</div>}
                            {techTasksLoading && <div>⏳ Loading tech tasks...</div>}
                        </div>
                    )}

                    {loading ? (
                        <div className="loading">Loading tasks...</div>
                    ) : error ? (
                        <div className="error">
                            {error}
                            <div style={{ marginTop: '1rem' }}>
                                <button onClick={fetchTasks}>Retry</button>
                            </div>
                        </div>
                    ) : (
                        <>
                                {alertCelebrationPieces.length > 0 && (
                                    <div className="alert-celebration" aria-hidden="true">
                                        {alertCelebrationPieces.map(piece => (
                                            <span
                                                key={piece.id}
                                                className="alert-confetti"
                                                style={{
                                                    '--confetti-left': `${piece.left}%`,
                                                    '--confetti-size': `${piece.size}px`,
                                                    '--confetti-height': `${piece.height}px`,
                                                    '--confetti-color': piece.color,
                                                    '--confetti-rot': `${piece.rotate}deg`,
                                                    '--confetti-drift': `${piece.drift}px`,
                                                    '--confetti-fall': `${piece.duration}s`,
                                                    '--confetti-delay': `${piece.delay}s`,
                                                    borderRadius: piece.shape === 'round' ? '999px' : '2px',
                                                    clipPath: piece.shape === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : 'none'
                                                }}
                                            />
                                        ))}
                                    </div>
                                )}
		                            {alertItemCount > 0 && (
		                                <div className={`alert-panels ${(!showMissingAlert && !showBlockedAlert && !showPostponedAlert && !showWaitingAlert && !showEmptyEpicAlert && !showDoneEpicAlert) ? 'collapsed' : ''}`}>
		                                    {consolidatedMissingStories.length > 0 && (
		                                        <div className={`alert-card missing ${showMissingAlert ? '' : 'collapsed'}`}>
	                                            <div className="alert-card-header">
	                                                <button
	                                                    className="alert-toggle"
	                                                    onClick={() => setShowMissingAlert(prev => !prev)}
	                                                    title={showMissingAlert ? 'Collapse missing info panel' : 'Expand missing info panel'}
	                                                >
	                                                    <span className="alert-toggle-icon" aria-hidden="true">
	                                                        <svg className={`alert-toggle-chevron ${showMissingAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
	                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	                                                        </svg>
	                                                    </span>
	                                                    <span className="alert-toggle-label">
	                                                        {showMissingAlert ? 'Hide' : 'Show'}
	                                                    </span>
	                                                </button>
	                                                <div className="alert-title">🧾 Missing Info</div>
	                                                <div className="alert-subtitle">These stories are missing planning essentials—fill the fields so they can be scheduled and estimated.</div>
		                                                <a
		                                                    className="alert-chip"
		                                                    href={buildKeyListLink(consolidatedMissingStories.map(item => item.task.key))}
		                                                    target="_blank"
		                                                    rel="noopener noreferrer"
		                                                    title="Open these stories in Jira"
		                                                >
		                                                    {consolidatedMissingStories.length} {consolidatedMissingStories.length === 1 ? 'story' : 'stories'}
		                                                </a>
		                                            </div>
                                            <div className={`alert-card-body ${showMissingAlert ? '' : 'collapsed'}`}>
                                                    {missingAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.task.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'} not ready</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'} not ready</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(({ task, missingFields }) => (
                                                                        <div key={task.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(task.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(task.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(task.key);
                                                                                    }}
                                                                                >
                                                                                    {task.key} · {task.fields.summary}
                                                                                </a>
                                                                            </div>
                                                                            <span className="alert-pill status">Missing: {missingFields.join(', ')}</span>
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Fix fields →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(task.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
	                                        </div>
	                                    )}

	                                    {blockedTasks.length > 0 && (
	                                        <div className={`alert-card blocked ${showBlockedAlert ? '' : 'collapsed'}`}>
                                            <div className="alert-card-header">
                                                <button
                                                    className="alert-toggle"
                                                    onClick={() => setShowBlockedAlert(prev => !prev)}
                                                    title={showBlockedAlert ? 'Collapse blocked panel' : 'Expand blocked panel'}
                                                >
                                                    <span className="alert-toggle-icon" aria-hidden="true">
                                                        <svg className={`alert-toggle-chevron ${showBlockedAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                    </span>
                                                    <span className="alert-toggle-label">
                                                        {showBlockedAlert ? 'Hide' : 'Show'}
                                                    </span>
                                                </button>
                                                <div className="alert-title">⛔️ Blocked</div>
                                                <div className="alert-subtitle">Let’s unblock these fast—call out what’s stuck, who’s needed, and what “done” looks like.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(blockedTasks.map(t => t.key), { addSprint: true })}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title="Open blocked stories in Jira"
	                                                >
	                                                    {blockedTasks.length} blocked
	                                                </a>
	                                            </div>
                                            <div className={`alert-card-body ${showBlockedAlert ? '' : 'collapsed'}`}>
                                                    {blockedAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys, { addSprint: true });
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'} blocked</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'} blocked</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(task => {
                                                                        return (
                                                                            <div key={task.key} className="alert-story alert-story-jump">
                                                                                <div
                                                                                    className="alert-story-main"
                                                                                    role="button"
                                                                                    tabIndex={0}
                                                                                    onClick={() => handleAlertStoryClick(task.key)}
                                                                                    onKeyDown={(event) => {
                                                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                                                            event.preventDefault();
                                                                                            handleAlertStoryClick(task.key);
                                                                                        }
                                                                                    }}
                                                                                >
                                                                                    <a
                                                                                        className="alert-story-link"
                                                                                        href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        onClick={(event) => {
                                                                                            event.preventDefault();
                                                                                            event.stopPropagation();
                                                                                            handleAlertStoryClick(task.key);
                                                                                        }}
                                                                                    >
                                                                                        {task.key} · {task.fields.summary}
                                                                                    </a>
                                                                                </div>
                                                                                <button
                                                                                    className="task-remove alert-remove"
                                                                                    onClick={(event) => {
                                                                                        event.stopPropagation();
                                                                                        dismissAlertItem(task.key);
                                                                                    }}
                                                                                    title="Dismiss from alerts"
                                                                                    type="button"
                                                                                >
                                                                                    ×
                                                                                </button>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
	                                        </div>
	                                    )}

                                        {(postponedTasks.length > 0 || futureRoutedEpics.length > 0) && (
                                            <div className={`alert-card following ${showPostponedAlert ? '' : 'collapsed'}`}>
                                                <div className="alert-card-header">
                                                    <button
                                                        className="alert-toggle"
                                                        onClick={() => setShowPostponedAlert(prev => !prev)}
                                                        title={showPostponedAlert ? 'Collapse postponed stories panel' : 'Expand postponed stories panel'}
                                                    >
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showPostponedAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                        <span className="alert-toggle-label">
                                                            {showPostponedAlert ? 'Hide' : 'Show'}
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">⏭️ Postponed Work</div>
                                                    <div className="alert-subtitle">Items that should be handled in a future sprint.</div>
                                                    <div className="alert-chip">
                                                        {postponedTasks.length + futureRoutedEpics.length} {(postponedTasks.length + futureRoutedEpics.length) === 1 ? 'item' : 'items'}
                                                    </div>
                                                </div>
                                                <div className={`alert-card-body ${showPostponedAlert ? '' : 'collapsed'}`}>
                                                    {postponedAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys, { addSprint: true });
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'}</span>
                                                                </a>
                                                            ) : (
                                                                <div className="alert-team-title">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'}</span>
                                                                </div>
                                                            )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(task => (
                                                                        <div key={task.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(task.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(task.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(task.key);
                                                                                    }}
                                                                                >
                                                                                    {task.key} · {task.fields.summary}
                                                                                </a>
                                                                            </div>
                                                                            <span className="alert-pill status">Postponed</span>
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Move to next sprint →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(task.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            );
                                                        })}
                                                    {futureRoutedEpics.length > 0 && (
                                                        <>
                                                            <div className="alert-section-title">Epics with only future-sprint stories</div>
                                                            {postponedEpicTeams.map(group => (
                                                                <div key={`future-epic-${group.id}`} className="alert-team-group">
                                                                    <div className="alert-team-header">
                                                                        {jiraUrl ? (
                                                                            <a
                                                                                className="alert-team-link"
                                                                                href={buildTeamStatusLink({
                                                                                    teamId: group.id !== 'unknown' ? group.id : undefined,
                                                                                    issueType: 'Epic',
                                                                                    statuses: ['Accepted', 'To Do', 'Pending']
                                                                                })}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                <span className="alert-pill team">{group.name}</span>
                                                                                <span>{group.items.length} epics</span>
                                                                            </a>
                                                                        ) : (
                                                                            <div className="alert-team-title">
                                                                                <span className="alert-pill team">{group.name}</span>
                                                                                <span>{group.items.length} epics</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="alert-stories">
                                                                        {group.items.map(epic => (
                                                                            <div key={epic.key} className="alert-story">
                                                                                <div className="alert-story-main" onClick={() => handleAlertStoryClick(epic.key)}>
                                                                                    {jiraUrl ? (
                                                                                        <a
                                                                                            className="alert-story-link"
                                                                                            href={`${jiraUrl}/browse/${epic.key}`}
                                                                                            target="_blank"
                                                                                            rel="noopener noreferrer"
                                                                                            onClick={(event) => event.stopPropagation()}
                                                                                        >
                                                                                            {epic.key}: {epic.summary}
                                                                                        </a>
                                                                                    ) : (
                                                                                        <div className="alert-story-link">{epic.key}: {epic.summary}</div>
                                                                                    )}
                                                                                    <div className="alert-story-note">Move epic sprint to a future sprint (not in current scope).</div>
                                                                                </div>
                                                                                <span className="alert-pill status">Move to future sprint</span>
                                                                                <button
                                                                                    className="task-remove alert-remove"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        dismissAlertItem(epic.key);
                                                                                    }}
                                                                                    title="Dismiss from alerts"
                                                                                >
                                                                                    ×
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {waitingForStoriesEpics.length > 0 && (
                                            <div className={`alert-card following ${showWaitingAlert ? '' : 'collapsed'}`}>
                                                <div className="alert-card-header">
                                                    <button
                                                        className="alert-toggle"
                                                        onClick={() => setShowWaitingAlert(prev => !prev)}
                                                        title={showWaitingAlert ? 'Collapse waiting for stories panel' : 'Expand waiting for stories panel'}
                                                    >
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showWaitingAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                        <span className="alert-toggle-label">
                                                            {showWaitingAlert ? 'Hide' : 'Show'}
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">⏳ Waiting for Stories</div>
                                                    <div className="alert-subtitle">Analysis epics are waiting for stories next quarter.</div>
                                                    <div className="alert-chip">
                                                        {waitingForStoriesEpics.length} {waitingForStoriesEpics.length === 1 ? 'item' : 'items'}
                                                    </div>
                                                </div>
                                                <div className={`alert-card-body ${showWaitingAlert ? '' : 'collapsed'}`}>
                                                    {analysisEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(epic.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }}
                                                                                >
                                                                                    {epic.key} · {epic.summary}
                                                                                </a>
                                                                                <div className="alert-story-note">Waiting for description to create stories.</div>
                                                                            </div>
                                                                            <span className="alert-pill status">{epic.status?.name || 'Waiting'}</span>
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Open epic →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(epic.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

		                                    {emptyEpicsForAlert.length > 0 && (
		                                        <div className={`alert-card empty-epic ${showEmptyEpicAlert ? '' : 'collapsed'}`}>
	                                            <div className="alert-card-header">
	                                                <button
	                                                    className="alert-toggle"
	                                                    onClick={() => setShowEmptyEpicAlert(prev => !prev)}
	                                                    title={showEmptyEpicAlert ? 'Collapse empty epic panel' : 'Expand empty epic panel'}
	                                                >
	                                                    <span className="alert-toggle-icon" aria-hidden="true">
	                                                        <svg className={`alert-toggle-chevron ${showEmptyEpicAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
	                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	                                                        </svg>
	                                                    </span>
	                                                    <span className="alert-toggle-label">
	                                                        {showEmptyEpicAlert ? 'Hide' : 'Show'}
	                                                    </span>
	                                                </button>
	                                                <div className="alert-title">🧺 Empty Epic</div>
	                                                <div className="alert-subtitle">These epics have zero stories—please review and create at least one story to make them actionable.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(emptyEpics.map(e => e.key))}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title="Open these epics in Jira"
	                                                >
                                                        {emptyEpicsForAlert.length} {emptyEpicsForAlert.length === 1 ? 'epic' : 'epics'}
                                                    </a>
                                                </div>
                                            <div className={`alert-card-body ${showEmptyEpicAlert ? '' : 'collapsed'}`}>
                                                    {emptyEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(epic.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }}
                                                                                >
                                                                                    {epic.key} · {epic.summary}
                                                                                </a>
                                                                            </div>
                                                                            {epic.status?.name && (
                                                                                <span className="alert-pill status">{epic.status.name}</span>
                                                                            )}
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Create story →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(epic.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
		                                        </div>
		                                    )}

		                                    {doneStoryEpics.length > 0 && (
		                                        <div className={`alert-card done-epic ${showDoneEpicAlert ? '' : 'collapsed'}`}>
	                                            <div className="alert-card-header">
	                                                <button
	                                                    className="alert-toggle"
	                                                    onClick={() => setShowDoneEpicAlert(prev => !prev)}
	                                                    title={showDoneEpicAlert ? 'Collapse ready-to-close epics panel' : 'Expand ready-to-close epics panel'}
	                                                >
	                                                    <span className="alert-toggle-icon" aria-hidden="true">
	                                                        <svg className={`alert-toggle-chevron ${showDoneEpicAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
	                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	                                                        </svg>
	                                                    </span>
	                                                    <span className="alert-toggle-label">
	                                                        {showDoneEpicAlert ? 'Hide' : 'Show'}
	                                                    </span>
	                                                </button>
	                                                <div className="alert-title">✅ Epic Ready to Close</div>
	                                                <div className="alert-subtitle">All stories are done, killed, or incomplete, but the epic is still open—time to close the loop.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(doneStoryEpics.map(e => e.key))}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title="Open these epics in Jira"
	                                                >
	                                                    {doneStoryEpics.length} {doneStoryEpics.length === 1 ? 'epic' : 'epics'}
	                                                </a>
	                                            </div>
                                            <div className={`alert-card-body ${showDoneEpicAlert ? '' : 'collapsed'}`}>
                                                    {doneEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(epic.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }}
                                                                                >
                                                                                    {epic.key} · {epic.summary}
                                                                                </a>
                                                                            </div>
                                                                            {epic.assignee?.displayName && (
                                                                                <span className="alert-pill status">{epic.assignee.displayName}</span>
                                                                            )}
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Close epic →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(epic.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
	                                        </div>
	                                    )}

	                                </div>
	                            )}
                            <div className="filters-strip">
                                <div className="filters-group">
                                    <div className="filters-label">Show only</div>
                                    <div className="stats">
                                        <div
                                            className={`stat-card total ${statusFilter === null ? 'active' : ''} ${baseFilteredTasks.length === 0 ? 'disabled' : ''}`}
                                            onClick={() => {
                                                if (baseFilteredTasks.length === 0) return;
                                                setStatusFilter(null);
                                            }}
                                        >
                                            <div className="stat-value">{baseFilteredTasks.length}</div>
                                            <div className="stat-label">Total Tasks</div>
                                            <div className="stats-note">{totalStoryPoints.toFixed(1)} SP</div>
                                        </div>
                                        <div
                                            className={`stat-card done ${statusFilter === 'done' ? 'active' : ''} ${doneTasksCount === 0 ? 'disabled' : ''}`}
                                            onClick={() => {
                                                if (doneTasksCount === 0) return;
                                                setStatusFilter(statusFilter === 'done' ? null : 'done');
                                            }}
                                        >
                                            <div className="stat-value">{doneTasksCount}</div>
                                            <div className="stat-label">Done Tasks</div>
                                            <div className="stats-note">{doneStoryPoints.toFixed(1)} SP</div>
                                        </div>
                                        <div
                                            className={`stat-card high-priority ${statusFilter === 'high-priority' ? 'active' : ''} ${highPriorityCount === 0 ? 'disabled' : ''}`}
                                            onClick={() => {
                                                if (highPriorityCount === 0) return;
                                                setStatusFilter(statusFilter === 'high-priority' ? null : 'high-priority');
                                            }}
                                        >
                                            <div className="stat-value">{highPriorityCount}</div>
                                            <div className="stat-label">High Priority</div>
                                            <div className="stats-note">{highPriorityStoryPoints.toFixed(1)} SP</div>
                                        </div>
                                        <div
                                            className={`stat-card minor ${statusFilter === 'minor-priority' ? 'active' : ''} ${minorPriorityCount === 0 ? 'disabled' : ''}`}
                                            onClick={() => {
                                                if (minorPriorityCount === 0) return;
                                                setStatusFilter(statusFilter === 'minor-priority' ? null : 'minor-priority');
                                            }}
                                        >
                                            <div className="stat-value">{minorPriorityCount}</div>
                                            <div className="stat-label">Minor + Lower</div>
                                            <div className="stats-note">{minorPriorityStoryPoints.toFixed(1)} SP</div>
                                        </div>
                                        <div
                                            className={`stat-card in-progress ${statusFilter === 'in-progress' ? 'active' : ''} ${inProgressTasksCount === 0 ? 'disabled' : ''}`}
                                            onClick={() => {
                                                if (inProgressTasksCount === 0) return;
                                                setStatusFilter(statusFilter === 'in-progress' ? null : 'in-progress');
                                            }}
                                        >
                                            <div className="stat-value">{inProgressTasksCount}</div>
                                            <div className="stat-label">In Progress</div>
                                            <div className="stats-note">{inProgressStoryPoints.toFixed(1)} SP</div>
                                        </div>
                                        <div
                                            className={`stat-card todo-accepted ${statusFilter === 'todo-accepted' ? 'active' : ''} ${todoAcceptedTasksCount === 0 ? 'disabled' : ''}`}
                                            onClick={() => {
                                                if (todoAcceptedTasksCount === 0) return;
                                                setStatusFilter(statusFilter === 'todo-accepted' ? null : 'todo-accepted');
                                            }}
                                        >
                                            <div className="stat-value">{todoAcceptedTasksCount}</div>
                                            <div className="stat-label">To Do / Pending / Accepted</div>
                                            <div className="stats-note">{todoAcceptedStoryPoints.toFixed(1)} SP</div>
                                        </div>
                                    </div>
                                </div>
                                <div className="filters-group">
                                    <div className="filters-label">Hide</div>
                                    <div className="toggle-container">
                                        <button
                                            className={`toggle ${showTech ? 'active' : ''}`}
                                            onClick={() => {
                                                setShowTech(!showTech);
                                            }}
                                        >
                                            {showTech
                                                ? `Hide Tech Tasks (${techTasksCount})`
                                                : `Show Tech Tasks (${techTasksCount})`}
                                        </button>
                                        <button
                                            className={`toggle ${showProduct ? 'active' : ''}`}
                                            onClick={() => setShowProduct(!showProduct)}
                                        >
                                            {showProduct ? `Hide Product Tasks (${productTasksCount})` : `Show Product Tasks (${productTasksCount})`}
                                        </button>
                                        {doneTasks.length > 0 && (
                                            <button
                                                className={`toggle ${showDone ? 'active' : ''}`}
                                                onClick={() => setShowDone(!showDone)}
                                            >
                                                {showDone ? `Hide Done Tasks (${doneTasks.length})` : `Show Done Tasks (${doneTasks.length})`}
                                            </button>
                                        )}
                                        {killedTasks.length > 0 && (
                                            <button
                                                className={`toggle ${showKilled ? 'active' : ''}`}
                                                onClick={() => setShowKilled(!showKilled)}
                                            >
                                                {showKilled ? `Hide Killed Tasks (${killedTasks.length})` : `Show Killed Tasks (${killedTasks.length})`}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {visibleTasks.length === 0 ? (
                                <div className="empty-state">
                                    <h2>No tasks found</h2>
                                    <p>There are no tasks matching the current criteria</p>
                                </div>
                            ) : (
                                <div
                                    className={`task-list ${activeDependencyFocus ? 'focus-mode' : ''}`}
                                    onClick={handleDependencyFocusClick}
                                >
                                    {epicGroups.map(epicGroup => {
                                        const epicInfo = epicGroup.epic;
                                        const epicTitle = epicInfo?.summary || epicGroup.parentSummary ||
                                            (epicGroup.key === 'NO_EPIC' ? 'No Epic Linked' : epicGroup.key);
                                        const epicTotalSp = epicGroup.storyPoints || 0;
                                        return (
                                            <div
                                                key={epicGroup.key}
                                                className={`epic-block ${excludedEpicSet.has(epicGroup.key) ? 'epic-excluded' : ''} ${stickyEpicFocusKey === epicGroup.key ? 'epic-block-sticky-focus' : ''}`}
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
                                                                <svg viewBox="0 0 24 24" fill="none">
                                                                    <rect x="3" y="3" width="18" height="18" rx="3" stroke="#1D7AFC" strokeWidth="2"/>
                                                                    <path d="M7.5 12.5l3 3 6-6" stroke="#1D7AFC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                                                                    className={`epic-stat-toggle ${excludedEpicSet.has(epicGroup.key) ? '' : 'active'}`}
                                                                    onClick={() => {
                                                                        const epicKey = epicGroup.key || 'NO_EPIC';
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
                                                                    {excludedEpicSet.has(epicGroup.key) ? 'Excluded' : 'Included'}
                                                                </button>
                                                            )}
                                                        </div>
	                                                    </div>
	                                                    <div className="epic-meta">
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
                                                    const isKilled = task.fields.status?.name === 'Killed';
                                                    const isDone = task.fields.status?.name === 'Done';
                                                    const teamInfo = getTeamInfo(task);
                                                    const rawDeps = showDependencies
                                                        ? (dependencyData[task.key] || []).filter(dep => dep.key && dep.category === 'dependency')
                                                        : [];
                                                    const rawBlockDeps = showDependencies
                                                        ? (dependencyData[task.key] || []).filter(dep => dep.key && dep.category === 'block')
                                                        : [];
                                                    const uniqueDeps = (() => {
                                                        const seen = new Set();
                                                        return rawDeps.filter(dep => {
                                                            const key = `${dep.key}-${dep.direction}`;
                                                            if (seen.has(key)) return false;
                                                            seen.add(key);
                                                            return true;
                                                        });
                                                    })();
                                                    const dependsOnAll = uniqueDeps.filter(dep => dep.direction === 'outward');
                                                    const dependentsAll = uniqueDeps.filter(dep => dep.direction === 'inward');
                                                    const dependsOnIds = dependsOnAll.map(dep => dep.key).filter(Boolean);
                                                    const dependentIds = dependentsAll.map(dep => dep.key).filter(Boolean);
                                                    const { blockedBy: blockedByIds, blocks: blocksIds } = getBlockLinkBuckets(rawBlockDeps, task.key);
                                                    const hasBlockLinks = blockedByIds.length > 0 || blocksIds.length > 0;
                                                    const hasDependencyLinks = dependsOnIds.length > 0 || dependentIds.length > 0;
                                                    const hasDeps = hasDependencyLinks || hasBlockLinks;
                                                    const hasCycle = dependsOnIds.some(id => dependentIds.includes(id) && issueByKey.has(id));
                                                    const isDependsFocusActive = dependencyFocus &&
                                                        dependencyFocus.taskKey === task.key &&
                                                        dependencyFocus.action === 'depends-on';
                                                    const isDependentsFocusActive = dependencyFocus &&
                                                        dependencyFocus.taskKey === task.key &&
                                                        dependencyFocus.action === 'dependents';
                                                    const isBlockedByFocusActive = dependencyFocus &&
                                                        dependencyFocus.taskKey === task.key &&
                                                        dependencyFocus.action === 'blocked-by';
                                                    const isBlocksFocusActive = dependencyFocus &&
                                                        dependencyFocus.taskKey === task.key &&
                                                        dependencyFocus.action === 'blocks';
                                                    const isDependsHoverActive = dependencyHover &&
                                                        dependencyHover.taskKey === task.key &&
                                                        dependencyHover.action === 'depends-on';
                                                    const isDependentsHoverActive = dependencyHover &&
                                                        dependencyHover.taskKey === task.key &&
                                                        dependencyHover.action === 'dependents';
                                                    const isBlockedByHoverActive = dependencyHover &&
                                                        dependencyHover.taskKey === task.key &&
                                                        dependencyHover.action === 'blocked-by';
                                                    const isBlocksHoverActive = dependencyHover &&
                                                        dependencyHover.taskKey === task.key &&
                                                        dependencyHover.action === 'blocks';
                                                    const isFocusActive = !!activeDependencyFocus;
                                                    const isRelated = !isFocusActive || focusRelatedSet.has(task.key);
                                                    const isFocused = isFocusActive && activeDependencyFocus.taskKey === task.key;
                                                    const isUpstream = isFocusActive &&
                                                        (activeDependencyFocus.action === 'depends-on' || activeDependencyFocus.action === 'blocked-by') &&
                                                        !isFocused &&
                                                        focusRelatedSet.has(task.key);
                                                    const isDownstream = isFocusActive &&
                                                        (activeDependencyFocus.action === 'dependents' || activeDependencyFocus.action === 'blocks') &&
                                                        !isFocused &&
                                                        focusRelatedSet.has(task.key);
                                                    const missingKeys = isFocused ? (dependencyFocus?.missingKeys || []) : [];
                                                    const dependencyKeyList = dependencyFocus?.dependencyKeys
                                                        || (dependencyFocus?.relatedKeys || []).filter(key => key !== task.key);
                                                    const hiddenKeys = isFocused
                                                        ? dependencyKeyList.filter(key => issueByKey.has(key) && !visibleTaskKeySet.has(key))
                                                        : [];
                                                    const missingInfoByKey = {};
                                                    uniqueDeps.forEach(dep => {
                                                        if (dep.key) {
                                                            missingInfoByKey[dep.key] = dep;
                                                        }
                                                    });
                                                    const missingLines = missingKeys.map(key => {
                                                        const lookup = dependencyLookupCache[key];
                                                        const info = missingInfoByKey[key] || {};
                                                        const status = lookup?.status || info.status || 'Unknown';
                                                        const summary = lookup?.summary || info.summary || 'Unknown summary';
                                                        const teamName = lookup?.teamName || info.teamName || 'Unknown team';
                                                        const assignee = lookup?.assignee || info.assignee || 'Unassigned';
                                                        const isDone = normalizeStatus(status) === 'done';
                                                        return { key, status, summary, teamName, assignee, isDone };
                                                    });
                                                    const hiddenLines = hiddenKeys.map(key => {
                                                        const lookup = issueByKey.get(key);
                                                        const info = missingInfoByKey[key] || {};
                                                        const status = lookup?.fields?.status?.name || lookup?.status?.name || lookup?.status || info.status || 'Unknown';
                                                        const summary = lookup?.fields?.summary || lookup?.summary || info.summary || 'Unknown summary';
                                                        const teamName = lookup?.fields
                                                            ? getTeamInfo(lookup).name
                                                            : (lookup?.teamName || info.teamName || 'Unknown team');
                                                        const assignee = lookup?.fields?.assignee?.displayName || lookup?.assignee?.displayName || info.assignee || 'Unassigned';
                                                        const isDone = normalizeStatus(status) === 'done';
                                                        return { key, status, summary, teamName, assignee, isDone };
                                                    });
                                                    return (
                                                        <div
                                                            key={task.key}
                                                            className={`task-item priority-${task.fields.priority?.name.toLowerCase()} ${isDone ? 'status-done' : ''} ${isKilled ? 'status-killed' : ''} ${isFocusActive && !isRelated ? 'is-dimmed' : ''} ${isFocused ? 'is-focused' : ''} ${isUpstream ? 'is-upstream' : ''} ${isDownstream ? 'is-downstream' : ''}`}
                                                            data-task-key={task.key}
                                                            data-task-id={task.id || task.key}
                                                            data-issue-key={task.key}
                                                        >
                                                            <div className="task-header">
                                                                <button
                                                                    className="task-remove"
                                                                    onClick={() => removeTask(task)}
                                                                    title="Remove task from view"
                                                                >
                                                                    ×
                                                                </button>
                                                            <div className="task-headline">
                                                                <span className="story-icon" aria-hidden="true" title="STORY">
                                                                        <svg viewBox="0 0 24 24" fill="none">
                                                                    <path d="M7 4h10a2 2 0 012 2v14l-7-4-7 4V6a2 2 0 012-2z" stroke="#55A630" strokeWidth="2" strokeLinejoin="round"/>
                                                                </svg>
                                                                </span>
                                                                {renderPriorityIcon(task.fields.priority?.name, task.key)}
                                                                <h3 className="task-title">
                                                                    <a href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'} target="_blank" rel="noopener noreferrer">
                                                                        {task.fields.summary}
                                                                    </a>
                                                                </h3>
                                                                    <span className="task-inline-meta">
                                                                        <a
                                                                            className="task-key-link"
                                                                            href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            {task.key}
                                                                        </a>
                                                                        {task.fields.customfield_10004 && (
                                                                            <span className="task-inline-sp">
                                                                                {task.fields.customfield_10004} SP
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    {showPlanning && (
                                                                        <input
                                                                            type="checkbox"
                                                                            className="task-checkbox"
                                                                            checked={!!selectedTasks[task.key]}
                                                                            onChange={() => toggleTaskSelection(task.key)}
                                                                            title="Select for sprint planning"
                                                                        />
                                                                    )}
                                                                </div>
                                                                <div className="task-header-right">
                                                                    {showDependencies && hasDependencyLinks && (
                                                                        <div className="dependency-pill-stack">
                                                                            {dependsOnIds.length > 0 && (
                                                                                <span className="dependency-pill blocked">← BLOCKED BY</span>
                                                                            )}
                                                                            {dependentIds.length > 0 && (
                                                                                <span className="dependency-pill blocker">BLOCKS →</span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="task-meta">
                                                                <span className={`task-status ${task.fields.status?.name.toLowerCase().replace(/\s+/g, '-')}`}>
                                                                    {task.fields.status?.name}
                                                                </span>
                                                                <span className="task-team">{teamInfo.name}</span>
                                                                {task.fields.assignee && (
                                                                    <span className="task-assignee">
                                                                        <span className="task-assignee-icon" aria-hidden="true">
                                                                            <svg viewBox="0 0 24 24" fill="none">
                                                                                <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Z" stroke="currentColor" strokeWidth="1.6"/>
                                                                                <path d="M4 20c1.8-4 6-5.5 8-5.5S18.2 16 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                                                                            </svg>
                                                                        </span>
                                                                        {task.fields.assignee.displayName}
                                                                    </span>
                                                                )}
                                                                {task.fields.updated && (
                                                                    <span className="task-updated">
                                                                        Last Update: {new Date(task.fields.updated).toLocaleDateString('en-CA')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {showDependencies && hasDeps && (
                                                                <div className="dependency-strip">
                                                                    {blockedByIds.length > 0 && (
                                                                        <button
                                                                            type="button"
                                                                            className={`dependency-count ${(isBlockedByFocusActive || isBlockedByHoverActive) ? 'active' : ''}`}
                                                                            data-dep-chip="blocked-by"
                                                                            data-task-id={task.id || task.key}
                                                                            data-task-key={task.key}
                                                                            aria-label={`Blocked by ${blockedByIds.length} tasks`}
                                                                            onMouseEnter={() => handleDependencyHoverEnter(task.key, 'blocked-by')}
                                                                            onMouseLeave={() => handleDependencyHoverLeave(task.key, 'blocked-by')}
                                                                        >
                                                                            BLOCKED BY {blockedByIds.length}
                                                                        </button>
                                                                    )}
                                                                    {blocksIds.length > 0 && (
                                                                        <button
                                                                            type="button"
                                                                            className={`dependency-count ${(isBlocksFocusActive || isBlocksHoverActive) ? 'active' : ''}`}
                                                                            data-dep-chip="blocks"
                                                                            data-task-id={task.id || task.key}
                                                                            data-task-key={task.key}
                                                                            aria-label={`Blocks ${blocksIds.length} tasks`}
                                                                            onMouseEnter={() => handleDependencyHoverEnter(task.key, 'blocks')}
                                                                            onMouseLeave={() => handleDependencyHoverLeave(task.key, 'blocks')}
                                                                        >
                                                                            BLOCKS {blocksIds.length}
                                                                        </button>
                                                                    )}
                                                                    {dependsOnIds.length > 0 && (
                                                                        <button
                                                                            type="button"
                                                                            className={`dependency-count ${(isDependsFocusActive || isDependsHoverActive) ? 'active' : ''}`}
                                                                            data-dep-chip="depends-on"
                                                                            data-task-id={task.id || task.key}
                                                                            data-task-key={task.key}
                                                                            aria-label={`Depends on ${dependsOnIds.length} tasks`}
                                                                            onMouseEnter={() => handleDependencyHoverEnter(task.key, 'depends-on')}
                                                                            onMouseLeave={() => handleDependencyHoverLeave(task.key, 'depends-on')}
                                                                        >
                                                                            DEPENDS ON {dependsOnIds.length}
                                                                        </button>
                                                                    )}
                                                                    {dependentIds.length > 0 && (
                                                                        <button
                                                                            type="button"
                                                                            className={`dependency-count ${(isDependentsFocusActive || isDependentsHoverActive) ? 'active' : ''}`}
                                                                            data-dep-chip="dependents"
                                                                            data-task-id={task.id || task.key}
                                                                            data-task-key={task.key}
                                                                            aria-label={`Dependents ${dependentIds.length} tasks`}
                                                                            onMouseEnter={() => handleDependencyHoverEnter(task.key, 'dependents')}
                                                                            onMouseLeave={() => handleDependencyHoverLeave(task.key, 'dependents')}
                                                                        >
                                                                            DEPENDENTS {dependentIds.length}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {showDependencies && isFocused && (missingLines.length > 0 || hiddenLines.length > 0) && (
                                                                <div className="dependency-missing">
                                                                    {hiddenLines.length > 0 && (
                                                                        <>
                                                                            <div className="dependency-missing-label hidden">Hidden by filter</div>
                                                                            {hiddenLines.map(item => (
                                                                                <div className="dependency-missing-item" key={`hidden-${item.key}`}>
                                                                                    <span>{item.teamName}</span>
                                                                                    <span className="dependency-missing-sep">·</span>
                                                                                    <span>{item.assignee}</span>
                                                                                    <span className="dependency-missing-sep">·</span>
                                                                                    <span>{item.summary}</span>
                                                                                    <span className="dependency-missing-sep">·</span>
                                                                                    <span>{item.key}</span>
                                                                                    <span className="dependency-missing-sep">·</span>
                                                                                    <span className={`dependency-missing-status ${item.isDone ? 'done' : ''}`}>{item.status}</span>
                                                                                </div>
                                                                            ))}
                                                                        </>
                                                                    )}
                                                                    {missingLines.length > 0 && (
                                                                        <>
                                                                            <div className="dependency-missing-label">Not loaded</div>
                                                                            {missingLines.map(item => (
                                                                                (jiraUrl ? (
                                                                                    <a
                                                                                        className="dependency-missing-item"
                                                                                        key={`missing-${item.key}`}
                                                                                        href={`${jiraUrl}/browse/${item.key}`}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        title={`Open ${item.key} in Jira`}
                                                                                    >
                                                                                        <span>{item.teamName}</span>
                                                                                        <span className="dependency-missing-sep">·</span>
                                                                                        <span>{item.assignee}</span>
                                                                                        <span className="dependency-missing-sep">·</span>
                                                                                        <span>{item.summary}</span>
                                                                                        <span className="dependency-missing-sep">·</span>
                                                                                        <span>{item.key}</span>
                                                                                        <span className="dependency-missing-sep">·</span>
                                                                                        <span className={`dependency-missing-status ${item.isDone ? 'done' : ''}`}>{item.status}</span>
                                                                                    </a>
                                                                                ) : (
                                                                                    <div className="dependency-missing-item" key={`missing-${item.key}`}>
                                                                                        <span>{item.teamName}</span>
                                                                                        <span className="dependency-missing-sep">·</span>
                                                                                        <span>{item.assignee}</span>
                                                                                        <span className="dependency-missing-sep">·</span>
                                                                                        <span>{item.summary}</span>
                                                                                        <span className="dependency-missing-sep">·</span>
                                                                                        <span>{item.key}</span>
                                                                                        <span className="dependency-missing-sep">·</span>
                                                                                        <span className={`dependency-missing-status ${item.isDone ? 'done' : ''}`}>{item.status}</span>
                                                                                    </div>
                                                                                ))
                                                                            ))}
                                                                            {dependencyLookupLoading && (
                                                                                <div className="dependency-missing-item">Loading issue details...</div>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div style={{marginTop: '3rem', textAlign: 'center'}}>
                                <button onClick={fetchTasks}>
                                    Refresh
                                </button>
                            </div>
                        </>
                    )}

                    {showGroupManage && (
                        <div
                            className="group-modal-backdrop"
                            role="dialog"
                            aria-modal="true"
                            onClick={requestCloseGroupManage}
                        >
                            <div className="group-modal" onClick={(event) => event.stopPropagation()}>
                                <div className="group-modal-header">
                                    <div className="group-modal-title-wrap">
                                        <div>
                                            <div className="group-modal-title">Dashboard Settings</div>
                                            <div className="group-modal-subtitle">Configure data sources and field mapping so planning metrics are calculated correctly.</div>
                                        </div>
                                    </div>
                                    {isGroupDraftDirty && (
                                        <div className="group-modal-dirty">Unsaved changes{unsavedSectionsCount > 0 ? ` · ${unsavedSectionsCount}` : ''}</div>
                                    )}
                                </div>
                                <div className="group-modal-tabs">
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'scope' ? 'active' : ''}`}
                                        onClick={() => setGroupManageTab('scope')}
                                        type="button"
                                    >Scope projects</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'source' ? 'active' : ''}`}
                                        onClick={() => setGroupManageTab('source')}
                                        type="button"
                                    >Jira source</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'mapping' ? 'active' : ''}`}
                                        onClick={() => setGroupManageTab('mapping')}
                                        type="button"
                                    >Field mapping</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'capacity' ? 'active' : ''}`}
                                        onClick={() => setGroupManageTab('capacity')}
                                        type="button"
                                    >Capacity</button>
                                    <button
                                        className={`group-modal-tab ${groupManageTab === 'teams' ? 'active' : ''}`}
                                        onClick={() => savedSelectedProjects.length > 0 && setGroupManageTab('teams')}
                                        type="button"
                                        disabled={savedSelectedProjects.length === 0}
                                        title={savedSelectedProjects.length === 0 ? 'Configure data sources first' : ''}
                                    >Team groups</button>
                                </div>
                                {(groupManageTab === 'scope' || groupManageTab === 'source' || groupManageTab === 'mapping' || groupManageTab === 'capacity') && (
                                    <div className="group-modal-body group-modal-split group-projects-layout">
                                        {(groupManageTab === 'source' || groupManageTab === 'scope') && (
                                        <>
                                        {groupManageTab === 'source' && (
                                        <div className="group-pane group-projects-pane-left group-single-pane" style={{ borderRight: 'none' }}>
                                            <div className="group-pane-tools group-pane-tools-right" style={{ padding: '0.8rem 1rem 0 1rem' }}>
                                                <button
                                                    className={`secondary compact ${showTechnicalFieldIds ? 'active' : ''}`}
                                                    onClick={() => setShowTechnicalFieldIds((prev) => !prev)}
                                                    type="button"
                                                >
                                                    {showTechnicalFieldIds ? 'Hide Jira technical IDs' : 'Show Jira technical IDs'}
                                                </button>
                                            </div>
                                            <div className="group-projects-subsection" style={{padding: '12px 16px 0'}}>
                                                <div className="group-pane-title">Jira Source</div>
                                                <div className="group-field-helper">Configure how sprint data is discovered and read from Jira.</div>
                                            </div>
                                            <div className="group-projects-subsection" style={{padding: '12px 16px 0'}}>
                                                <div className="team-selector-label">Sprint Field</div>
                                                <div className="group-field-helper">Used to determine which sprint each ticket belongs to.</div>
                                                <div className="capacity-inline-row">
                                                    {sprintFieldNameDraft ? (
                                                        <div className="selected-team-chip" title={sprintFieldIdDraft || ''}>
                                                            <span className="team-name"><strong>{sprintFieldNameDraft}</strong>{showTechnicalFieldIds && sprintFieldIdDraft && <span className="field-id-hint">({sprintFieldIdDraft})</span>}</span>
                                                            <button className="remove-btn" onClick={() => { setSprintFieldIdDraft(''); setSprintFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove sprint field">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input type="text" className="team-search-input" placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'} value={sprintFieldSearchQuery} onChange={(e) => { setSprintFieldSearchQuery(e.target.value); setSprintFieldSearchOpen(true); setSprintFieldSearchIndex(0); }} onFocus={() => setSprintFieldSearchOpen(true)} onBlur={() => { window.setTimeout(() => setSprintFieldSearchOpen(false), 120); }} onKeyDown={handleSprintFieldSearchKeyDown} ref={sprintFieldSearchInputRef} disabled={loadingFields && !jiraFields.length} />
                                                        {sprintFieldSearchOpen && sprintFieldSearchResults.length > 0 && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {sprintFieldSearchResults.map((f, index) => (
                                                                    <div key={f.id} className={`team-search-result-item ${index === sprintFieldSearchIndex ? 'active' : ''}`} onClick={() => { setSprintFieldIdDraft(f.id); setSprintFieldNameDraft(f.name); setSprintFieldSearchQuery(''); setSprintFieldSearchOpen(false); }}>
                                                                        <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="group-projects-subsection" style={{padding: '12px 16px 12px'}}>
                                                <div className="team-selector-label">Sprint Board (optional)</div>
                                                <div className="group-field-helper">Used for faster sprint loading. If empty, the server falls back to env/default issue-based sprint discovery.</div>
                                                <div className="capacity-inline-row">
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input
                                                            type="text"
                                                            className="team-search-input"
                                                            placeholder={loadingBoards ? 'Loading boards...' : 'Search boards...'}
                                                            value={boardSearchQuery}
                                                            onChange={(e) => { setBoardSearchQuery(e.target.value); setBoardSearchOpen(true); setBoardSearchIndex(0); }}
                                                            onFocus={() => {
                                                                setBoardSearchOpen(true);
                                                                if (!jiraBoards.length && !loadingBoards) fetchJiraBoards();
                                                            }}
                                                            onBlur={() => { window.setTimeout(() => setBoardSearchOpen(false), 120); }}
                                                            onKeyDown={handleBoardSearchKeyDown}
                                                            ref={boardSearchInputRef}
                                                            disabled={loadingBoards && !jiraBoards.length}
                                                        />
                                                        {boardSearchOpen && boardSearchQuery.trim() && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {loadingBoards ? (
                                                                    <div className="team-search-result-item is-empty">Loading boards...</div>
                                                                ) : boardSearchResults.length === 0 ? (
                                                                    <div className="team-search-result-item is-empty">No boards found</div>
                                                                ) : boardSearchResults.map((b, index) => (
                                                                    <div
                                                                        key={b.id}
                                                                        className={`team-search-result-item ${index === boardSearchIndex ? 'active' : ''}`}
                                                                        onClick={() => {
                                                                            setBoardIdDraft(String(b.id || ''));
                                                                            setBoardNameDraft(String(b.name || ''));
                                                                            setBoardSearchQuery('');
                                                                            setBoardSearchOpen(false);
                                                                        }}
                                                                    >
                                                                        <strong>{b.name || `Board ${b.id}`}</strong> <span style={{opacity: 0.55}}>({b.id}{b.type ? ` · ${b.type}` : ''})</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                {boardIdDraft ? (
                                                    <div className="selected-teams-list" style={{ marginTop: '0.45rem' }}>
                                                        <div className="selected-team-chip" title={boardIdDraft}>
                                                            <span className="team-name">
                                                                <strong>{boardNameDraft || `Board ${boardIdDraft}`}</strong>
                                                                {showTechnicalFieldIds && boardNameDraft ? ` (${boardIdDraft})` : ''}
                                                            </span>
                                                            <button className="remove-btn" onClick={clearBoardSelection} type="button" title="Clear board" aria-label="Clear sprint board">&times;</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="team-selector-empty">No board selected (fallback mode).</div>
                                                )}
                                            </div>
                                        </div>
                                        )}
                                        {groupManageTab === 'scope' && (
                                        <div className="group-pane group-projects-pane-right group-single-pane">
                                            <div className="group-pane-header group-projects-pane-header">
                                                <div className="group-pane-title">Dashboard Projects</div>
                                                <div className="group-projects-desc">
                                                    Select which Jira projects to include in dashboard queries and assign each to Product or Tech for the planning split.
                                                </div>
                                                <div className="team-search-wrapper">
                                                    <input
                                                        type="text"
                                                        className="team-search-input"
                                                        placeholder={loadingProjects ? 'Loading projects...' : 'Search projects to add...'}
                                                        value={projectSearchQuery}
                                                        onChange={(e) => { setProjectSearchQuery(e.target.value); setProjectSearchOpen(true); setProjectSearchIndex(0); }}
                                                        onFocus={() => setProjectSearchOpen(true)}
                                                        onBlur={() => { window.setTimeout(() => setProjectSearchOpen(false), 120); }}
                                                        onKeyDown={handleProjectSearchKeyDown}
                                                        ref={projectSearchInputRef}
                                                        disabled={loadingProjects && !jiraProjects.length}
                                                    />
                                                    {projectSearchOpen && projectSearchQuery.trim() && (
                                                        <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                            {projectSearchRemoteLoading ? (
                                                                <div className="team-search-result-item is-empty">Searching Jira projects...</div>
                                                            ) : projectSearchResults.length === 0 ? (
                                                                <div className="team-search-result-item is-empty">No projects found</div>
                                                            ) : projectSearchResults.map((p, index) => (
                                                                <div
                                                                    key={p.key}
                                                                    className={`team-search-result-item ${index === projectSearchIndex ? 'active' : ''}`}
                                                                >
                                                                    <span className="project-result-label"><strong>{p.key}</strong> &mdash; {p.name}</span>
                                                                    <span className="project-result-actions">
                                                                        <button type="button" className="project-type-btn product" onClick={() => addProjectSelection(p.key, 'product')}>Product</button>
                                                                        <button type="button" className="project-type-btn tech" onClick={() => addProjectSelection(p.key, 'tech')}>Tech</button>
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="group-pane-list group-projects-pane-list">
                                                <div className="group-projects-subsection">
                                                    <div className="team-selector-label">Product</div>
                                                    <div className="group-field-helper">Projects counted as Product work in planning and stats.</div>
                                                    {selectedProjectsDraft.filter(p => p.type === 'product').length === 0 ? (
                                                        <div className="team-selector-empty">No product projects.</div>
                                                    ) : (
                                                        <div className="selected-teams-list">
                                                            {selectedProjectsDraft.filter(p => p.type === 'product').map(p => (
                                                                <div key={p.key} className="selected-team-chip product-chip">
                                                                    <span className="team-name"><strong>{p.key}</strong>{resolveProjectName(p.key) !== p.key ? ` \u2014 ${resolveProjectName(p.key)}` : ''}</span>
                                                                    <button className="remove-btn" onClick={() => removeProjectSelection(p.key)} type="button" title="Remove project" aria-label={`Remove product project ${p.key}`}>&times;</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="group-projects-subsection">
                                                    <div className="team-selector-label">Tech</div>
                                                    <div className="group-field-helper">Projects counted as Tech work in planning and stats.</div>
                                                    {selectedProjectsDraft.filter(p => p.type === 'tech').length === 0 ? (
                                                        <div className="team-selector-empty">No tech projects.</div>
                                                    ) : (
                                                        <div className="selected-teams-list">
                                                            {selectedProjectsDraft.filter(p => p.type === 'tech').map(p => (
                                                                <div key={p.key} className="selected-team-chip tech-chip">
                                                                    <span className="team-name"><strong>{p.key}</strong>{resolveProjectName(p.key) !== p.key ? ` \u2014 ${resolveProjectName(p.key)}` : ''}</span>
                                                                    <button className="remove-btn" onClick={() => removeProjectSelection(p.key)} type="button" title="Remove project" aria-label={`Remove tech project ${p.key}`}>&times;</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        )}
                                        </>
                                        )}
                                        {(groupManageTab === 'mapping' || groupManageTab === 'capacity') && (
                                        <div className="group-pane group-projects-pane-right group-single-pane">
                                            <div className="group-pane-tools group-pane-tools-right">
                                                <button
                                                    className={`secondary compact ${showTechnicalFieldIds ? 'active' : ''}`}
                                                    onClick={() => setShowTechnicalFieldIds((prev) => !prev)}
                                                    type="button"
                                                >
                                                    {showTechnicalFieldIds ? 'Hide Jira technical IDs' : 'Show Jira technical IDs'}
                                                </button>
                                            </div>
                                            {groupManageTab === 'mapping' && (
                                            <>
                                            <div className="group-projects-section group-config-card">
                                                <div className="group-pane-title">Issue Type</div>
                                                <div className="group-field-helper">Only these issue types are loaded into the dashboard.</div>
                                                <div className="capacity-inline-row">
                                                    {issueTypesDraft.length > 0 ? (
                                                        <div className="selected-team-chip issue-type-chip">
                                                            <span className="team-name">{issueTypesDraft[0]}</span>
                                                            <button className="remove-btn" onClick={() => removeIssueType(issueTypesDraft[0])} type="button" title="Remove" aria-label={`Remove issue type ${issueTypesDraft[0]}`}>&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input
                                                            type="text"
                                                            className="team-search-input"
                                                            placeholder="Search issue types..."
                                                            value={issueTypeSearchQuery}
                                                            onChange={(e) => { setIssueTypeSearchQuery(e.target.value); setIssueTypeSearchOpen(true); setIssueTypeSearchIndex(0); }}
                                                            onFocus={() => setIssueTypeSearchOpen(true)}
                                                            onBlur={() => { window.setTimeout(() => setIssueTypeSearchOpen(false), 120); }}
                                                            onKeyDown={handleIssueTypeSearchKeyDown}
                                                            ref={issueTypeSearchInputRef}
                                                        />
                                                        {issueTypeSearchOpen && issueTypeSearchQuery.trim() && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {issueTypeSearchResults.length === 0 ? (
                                                                    <div className="team-search-result-item is-empty">No issue types found</div>
                                                                ) : issueTypeSearchResults.map((it, index) => (
                                                                    <div
                                                                        key={it.name}
                                                                        className={`team-search-result-item ${index === issueTypeSearchIndex ? 'active' : ''}`}
                                                                        onClick={() => addIssueType(it.name)}
                                                                    >
                                                                        {it.name}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                                {issueTypesDraft.length === 0 && (
                                                    <div className="team-selector-empty">No filter — all issue types will be included.</div>
                                                )}
                                            </div>
                                            <div className="group-projects-subsection">
                                                <div className="team-selector-label">Parent Name Field</div>
                                                <div className="group-field-helper">Field used to map stories back to their parent epic name.</div>
                                                <div className="capacity-inline-row">
                                                    {parentNameFieldNameDraft ? (
                                                        <div className="selected-team-chip" title={parentNameFieldIdDraft || ''}>
                                                            <span className="team-name"><strong>{parentNameFieldNameDraft}</strong>{showTechnicalFieldIds && parentNameFieldIdDraft && <span className="field-id-hint">({parentNameFieldIdDraft})</span>}</span>
                                                            <button className="remove-btn" onClick={() => { setParentNameFieldIdDraft(''); setParentNameFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove parent name field">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input type="text" className="team-search-input" placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'} value={parentNameFieldSearchQuery} onChange={(e) => { setParentNameFieldSearchQuery(e.target.value); setParentNameFieldSearchOpen(true); setParentNameFieldSearchIndex(0); }} onFocus={() => setParentNameFieldSearchOpen(true)} onBlur={() => { window.setTimeout(() => setParentNameFieldSearchOpen(false), 120); }} onKeyDown={handleParentNameFieldSearchKeyDown} ref={parentNameFieldSearchInputRef} disabled={loadingFields && !jiraFields.length} />
                                                        {parentNameFieldSearchOpen && parentNameFieldSearchResults.length > 0 && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {parentNameFieldSearchResults.map((f, index) => (
                                                                    <div key={f.id} className={`team-search-result-item ${index === parentNameFieldSearchIndex ? 'active' : ''}`} onClick={() => { setParentNameFieldIdDraft(f.id); setParentNameFieldNameDraft(f.name); setParentNameFieldSearchQuery(''); setParentNameFieldSearchOpen(false); }}>
                                                                        <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="group-projects-subsection">
                                                <div className="team-selector-label">Story Points Field</div>
                                                <div className="group-field-helper">Field used for effort, velocity, and capacity comparisons.</div>
                                                <div className="capacity-inline-row">
                                                    {storyPointsFieldNameDraft ? (
                                                        <div className="selected-team-chip" title={storyPointsFieldIdDraft || ''}>
                                                            <span className="team-name"><strong>{storyPointsFieldNameDraft}</strong>{showTechnicalFieldIds && storyPointsFieldIdDraft && <span className="field-id-hint">({storyPointsFieldIdDraft})</span>}</span>
                                                            <button className="remove-btn" onClick={() => { setStoryPointsFieldIdDraft(''); setStoryPointsFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove story points field">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input type="text" className="team-search-input" placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'} value={storyPointsFieldSearchQuery} onChange={(e) => { setStoryPointsFieldSearchQuery(e.target.value); setStoryPointsFieldSearchOpen(true); setStoryPointsFieldSearchIndex(0); }} onFocus={() => setStoryPointsFieldSearchOpen(true)} onBlur={() => { window.setTimeout(() => setStoryPointsFieldSearchOpen(false), 120); }} onKeyDown={handleStoryPointsFieldSearchKeyDown} ref={storyPointsFieldSearchInputRef} disabled={loadingFields && !jiraFields.length} />
                                                        {storyPointsFieldSearchOpen && storyPointsFieldSearchResults.length > 0 && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {storyPointsFieldSearchResults.map((f, index) => (
                                                                    <div key={f.id} className={`team-search-result-item ${index === storyPointsFieldSearchIndex ? 'active' : ''}`} onClick={() => { setStoryPointsFieldIdDraft(f.id); setStoryPointsFieldNameDraft(f.name); setStoryPointsFieldSearchQuery(''); setStoryPointsFieldSearchOpen(false); }}>
                                                                        <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="group-projects-subsection">
                                                <div className="team-selector-label">Team Field</div>
                                                <div className="group-field-helper">Field used to assign each ticket to a team.</div>
                                                <div className="capacity-inline-row">
                                                    {teamFieldNameDraft ? (
                                                        <div className="selected-team-chip" title={teamFieldIdDraft || ''}>
                                                            <span className="team-name"><strong>{teamFieldNameDraft}</strong>{showTechnicalFieldIds && teamFieldIdDraft && <span className="field-id-hint">({teamFieldIdDraft})</span>}</span>
                                                            <button className="remove-btn" onClick={() => { setTeamFieldIdDraft(''); setTeamFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove team field">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input type="text" className="team-search-input" placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'} value={teamFieldSearchQuery} onChange={(e) => { setTeamFieldSearchQuery(e.target.value); setTeamFieldSearchOpen(true); setTeamFieldSearchIndex(0); }} onFocus={() => setTeamFieldSearchOpen(true)} onBlur={() => { window.setTimeout(() => setTeamFieldSearchOpen(false), 120); }} onKeyDown={handleTeamFieldSearchKeyDown} ref={teamFieldSearchInputRef} disabled={loadingFields && !jiraFields.length} />
                                                        {teamFieldSearchOpen && teamFieldSearchResults.length > 0 && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {teamFieldSearchResults.map((f, index) => (
                                                                    <div key={f.id} className={`team-search-result-item ${index === teamFieldSearchIndex ? 'active' : ''}`} onClick={() => { setTeamFieldIdDraft(f.id); setTeamFieldNameDraft(f.name); setTeamFieldSearchQuery(''); setTeamFieldSearchOpen(false); }}>
                                                                        <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            </>
                                            )}
                                            {groupManageTab === 'capacity' && (
                                            <div className="group-projects-section group-config-card">
                                                <div className="group-pane-title">Capacity Project</div>
                                                <div className="group-projects-desc">
                                                    Select one Jira project that stores team capacity entries, and the field used for estimated capacity.
                                                </div>
                                                <div className="capacity-inline-row">
                                                    {capacityProjectDraft ? (
                                                        <div className="selected-team-chip">
                                                            <span className="team-name"><strong>{capacityProjectDraft}</strong>{resolveCapacityProjectName(capacityProjectDraft) ? ` \u2014 ${resolveCapacityProjectName(capacityProjectDraft)}` : ''}</span>
                                                            <button className="remove-btn" onClick={() => setCapacityProjectDraft('')} type="button" title="Remove" aria-label="Remove capacity project">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input
                                                            type="text"
                                                            className="team-search-input"
                                                            placeholder="Search projects..."
                                                            value={capacityProjectSearchQuery}
                                                            onChange={(e) => { setCapacityProjectSearchQuery(e.target.value); setCapacityProjectSearchOpen(true); setCapacityProjectSearchIndex(0); }}
                                                            onFocus={() => setCapacityProjectSearchOpen(true)}
                                                            onBlur={() => { window.setTimeout(() => setCapacityProjectSearchOpen(false), 120); }}
                                                            onKeyDown={handleCapacityProjectSearchKeyDown}
                                                            ref={capacityProjectSearchInputRef}
                                                        />
                                                        {capacityProjectSearchOpen && capacityProjectSearchQuery.trim() && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {capacityProjectSearchResults.length === 0 ? (
                                                                    <div className="team-search-result-item is-empty">No projects found</div>
                                                                ) : capacityProjectSearchResults.map((p, index) => (
                                                                    <div
                                                                        key={p.key}
                                                                        className={`team-search-result-item ${index === capacityProjectSearchIndex ? 'active' : ''}`}
                                                                        onClick={() => { setCapacityProjectDraft(p.key); setCapacityProjectSearchQuery(''); setCapacityProjectSearchOpen(false); }}
                                                                    >
                                                                        <strong>{p.key}</strong> &mdash; {p.name}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                                <div className="group-projects-subsection">
                                                    <div className="team-selector-label">Capacity Field</div>
                                                    <div className="group-field-helper">Numeric field that stores each team capacity entry.</div>
                                                    <div className="capacity-inline-row">
                                                        {capacityFieldNameDraft ? (
                                                            <div className="selected-team-chip" title={capacityFieldIdDraft || ''}>
                                                                <span className="team-name"><strong>{capacityFieldNameDraft}</strong>{showTechnicalFieldIds && capacityFieldIdDraft && <span className="field-id-hint">({capacityFieldIdDraft})</span>}</span>
                                                                <button className="remove-btn" onClick={() => { setCapacityFieldIdDraft(''); setCapacityFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove capacity field">&times;</button>
                                                            </div>
                                                        ) : (
                                                        <div className="team-search-wrapper capacity-inline-search">
                                                            <input
                                                                type="text"
                                                                className="team-search-input"
                                                                placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'}
                                                                value={capacityFieldSearchQuery}
                                                                onChange={(e) => { setCapacityFieldSearchQuery(e.target.value); setCapacityFieldSearchOpen(true); setCapacityFieldSearchIndex(0); }}
                                                                onFocus={() => setCapacityFieldSearchOpen(true)}
                                                                onBlur={() => { window.setTimeout(() => setCapacityFieldSearchOpen(false), 120); }}
                                                                onKeyDown={handleCapacityFieldSearchKeyDown}
                                                                ref={capacityFieldSearchInputRef}
                                                                disabled={loadingFields && !jiraFields.length}
                                                            />
                                                            {capacityFieldSearchOpen && capacityFieldSearchResults.length > 0 && (
                                                                <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                    {capacityFieldSearchResults.map((f, index) => (
                                                                        <div
                                                                            key={f.id}
                                                                            className={`team-search-result-item ${index === capacityFieldSearchIndex ? 'active' : ''}`}
                                                                            onClick={() => { setCapacityFieldIdDraft(f.id); setCapacityFieldNameDraft(f.name); setCapacityFieldSearchQuery(''); setCapacityFieldSearchOpen(false); }}
                                                                        >
                                                                            <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            )}
                                        </div>
                                        )}
                                    </div>
                                )}
                                {groupManageTab === 'teams' && (
                                <div className="group-modal-body group-modal-split">
                                    <div className={`group-pane group-pane-left ${showGroupListMobile ? 'is-mobile-active' : ''}`}>
                                        <div className="group-pane-header">
                                            <div className="group-pane-header-row">
                                                <div className="group-pane-title">Groups</div>
                                                <button className="secondary compact group-add-button" onClick={addGroupDraftRow} type="button">
                                                    + Add group
                                                </button>
                                            </div>
                                            <div className="group-pane-search">
                                                <input
                                                    type="text"
                                                    className="group-filter-input"
                                                    placeholder="Search groups or teams..."
                                                    value={groupSearchQuery}
                                                    onChange={(event) => setGroupSearchQuery(event.target.value)}
                                                />
                                            </div>
                                            <div className="group-pane-count">
                                                {filteredGroupDrafts.length} group{filteredGroupDrafts.length !== 1 ? 's' : ''}
                                            </div>
                                            <button
                                                className="group-pane-mobile-close"
                                                onClick={() => setShowGroupListMobile(false)}
                                                type="button"
                                            >
                                                Back
                                            </button>
                                        </div>
                                        <div className="group-pane-list">
                                            {filteredGroupDrafts.length === 0 ? (
                                                <div className="group-pane-empty">No groups match this search.</div>
                                            ) : filteredGroupDrafts.map(group => {
                                                const teamCount = (group.teamIds || []).length;
                                                const isActive = activeGroupDraft?.id === group.id;
                                                const isDefault = groupDraft?.defaultGroupId === group.id;
                                                return (
                                                    <button
                                                        key={group.id}
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
                                                        <div className="group-list-star" aria-hidden="true">
                                                            {isDefault ? '★' : '☆'}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="group-pane group-pane-right">
                                        <div className="group-pane-mobile-header">
                                            <button
                                                className="secondary compact"
                                                onClick={() => setShowGroupListMobile(true)}
                                                type="button"
                                            >
                                                Groups
                                            </button>
                                            <div className="group-pane-mobile-title">
                                                {activeGroupDraft ? (activeGroupDraft.name || 'Untitled group') : 'No group selected'}
                                            </div>
                                        </div>
                                        {groupsError && (
                                            <div className="group-modal-warning">{groupsError}</div>
                                        )}
                                        {(groupWarnings || []).length > 0 && (
                                            <div className="group-modal-warning">
                                                {(groupWarnings || []).join(' ')}
                                            </div>
                                        )}
                                        {groupDraftError && (
                                            <div className="group-modal-warning">{groupDraftError}</div>
                                        )}
                                        <div className="group-pane-tools">
                                            <button
                                                className="secondary compact"
                                                onClick={fetchAllTeamsFromJira}
                                                type="button"
                                                disabled={loadingTeams}
                                            >
                                                {loadingTeams ? 'Refreshing...' : 'Refresh teams'}
                                            </button>
                                            <span className="group-modal-meta">{teamCacheLabel}</span>
                                            <span className="group-modal-helper" title="Team list is scoped to the currently selected sprint.">
                                                Scoped to sprint
                                            </span>
                                        </div>
                                        {loadingTeams && (
                                            <div className="group-modal-meta">Loading teams...</div>
                                        )}
                                        {(groupDraft?.groups || []).length === 0 && (
                                            <div className="group-pane-empty">No groups yet. Click "Add group" to create one.</div>
                                        )}
                                        {activeGroupDraft ? (
                                            <div className="group-editor">
                                                <div className="group-editor-header">
                                                    <input
                                                        type="text"
                                                        value={activeGroupDraft.name}
                                                        onChange={(event) => updateGroupDraftName(activeGroupDraft.id, event.target.value)}
                                                        placeholder="Group name"
                                                        className="group-name-input"
                                                    />
                                                    <button
                                                        className={`group-star-button ${groupDraft?.defaultGroupId === activeGroupDraft.id ? 'active' : ''}`}
                                                        onClick={() => toggleDefaultGroupDraft(activeGroupDraft.id)}
                                                        title="Set as default group"
                                                        aria-label={groupDraft?.defaultGroupId === activeGroupDraft.id ? 'Unset default group' : 'Set as default group'}
                                                        type="button"
                                                    >
                                                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                                            <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.6l5.8-.8L12 3.5z"/>
                                                        </svg>
                                                    </button>
                                                    <button
                                                        className="secondary compact"
                                                        onClick={() => duplicateGroupDraft(activeGroupDraft.id)}
                                                        type="button"
                                                    >
                                                        Duplicate
                                                    </button>
                                                </div>
                                                <div className="team-selector">
                                                    <div className="team-selector-header">
                                                        <div className="team-selector-label">
                                                            Teams {(activeGroupDraft.teamIds || []).length}/12
                                                        </div>
                                                        {(activeGroupDraft.teamIds || []).length >= 12 && (
                                                            <div className="team-selector-limit">Limit reached (12 max)</div>
                                                        )}
                                                    </div>
                                                    {(activeGroupDraft.teamIds || []).length === 0 ? (
                                                        <div className="team-selector-empty">
                                                            No teams selected. Search and add teams below.
                                                        </div>
                                                    ) : (
                                                        <div className="selected-teams-list is-capped">
                                                            {(activeGroupDraft.teamIds || []).map((teamId, index) => {
                                                                const teamName = resolveTeamName(teamId);
                                                                const isLast = index === (activeGroupDraft.teamIds || []).length - 1;
                                                                return (
                                                                    <div key={teamId} className="selected-team-chip">
                                                                        <span className="team-name">{teamName}</span>
                                                                        <button
                                                                            className="remove-btn"
                                                                            onClick={() => removeTeamFromGroup(activeGroupDraft.id, teamId)}
                                                                            type="button"
                                                                            title="Remove team"
                                                                            ref={isLast ? (node) => { teamChipLastRef.current[activeGroupDraft.id] = node; } : null}
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    {availableTeams.length === 0 && !loadingTeams ? (
                                                        <div className="team-selector-empty">
                                                            No teams available. Load tasks first or refresh teams above.
                                                        </div>
                                                    ) : (activeGroupDraft.teamIds || []).length < 12 && (
                                                        <div className="team-search-wrapper">
                                                            <input
                                                                type="text"
                                                                className="team-search-input"
                                                                placeholder="Search teams to add..."
                                                                value={activeTeamQuery}
                                                                onChange={(event) => handleTeamSearchChange(activeGroupDraft.id, event.target.value)}
                                                                onFocus={() => handleTeamSearchFocus(activeGroupDraft.id)}
                                                                onBlur={() => handleTeamSearchBlur(activeGroupDraft.id)}
                                                                onKeyDown={(event) => handleTeamSearchKeyDown(activeGroupDraft.id, event, activeTeamResultsLimited)}
                                                                ref={(node) => { teamSearchInputRefs.current[activeGroupDraft.id] = node; }}
                                                            />
                                                            {teamSearchOpen[activeGroupDraft.id] && activeTeamQuery.trim() && (
                                                                <div
                                                                    className={`team-search-results ${(activeGroupDraft.teamIds || []).length >= 12 ? 'disabled' : ''}`}
                                                                    onMouseDown={(event) => event.preventDefault()}
                                                                >
                                                                    {activeTeamResultsLimited.length === 0 ? (
                                                                        <div className="team-search-result-item is-empty">
                                                                            No teams found
                                                                        </div>
                                                                    ) : activeTeamResultsLimited.map((team, index) => (
                                                                        <div
                                                                            key={team.id}
                                                                            className={`team-search-result-item ${index === activeTeamIndex ? 'active' : ''}`}
                                                                            onClick={() => addTeamToGroup(activeGroupDraft.id, team.id)}
                                                                        >
                                                                            {team.name}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {teamSearchFeedback[activeGroupDraft.id] && (
                                                                <div className={`team-search-feedback ${teamSearchFeedback[activeGroupDraft.id].tone || ''}`}>
                                                                    {teamSearchFeedback[activeGroupDraft.id].message}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="component-selector">
                                                    <label className="component-selector-label">Components for missing info</label>
                                                    {(activeGroupDraft?.missingInfoComponents || []).length > 0 && (
                                                        <div className="selected-components-list">
                                                            {activeGroupDraft.missingInfoComponents.map(comp => (
                                                                <div key={comp} className="component-chip">
                                                                    <span className="component-name">{comp}</span>
                                                                    <button
                                                                        className="remove-btn"
                                                                        onClick={() => removeGroupMissingInfoComponent(activeGroupDraft.id, comp)}
                                                                        title={`Remove ${comp}`}
                                                                        type="button"
                                                                    >×</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="component-search-wrapper">
                                                        <input
                                                            type="text"
                                                            className="component-search-input"
                                                            placeholder="Search components..."
                                                            value={componentSearchQuery}
                                                            onChange={(e) => {
                                                                setComponentSearchQuery(e.target.value);
                                                                setComponentSearchOpen(true);
                                                            }}
                                                            onFocus={() => setComponentSearchOpen(true)}
                                                            onBlur={() => window.setTimeout(() => setComponentSearchOpen(false), 200)}
                                                            onKeyDown={handleComponentSearchKeyDown}
                                                        />
                                                        {componentSearchOpen && componentSearchQuery.trim() && (
                                                            <div className="component-search-results">
                                                                {componentSearchLoading ? (
                                                                    <div className="component-search-result-item is-empty">Searching...</div>
                                                                ) : filteredComponentSearchResults.length === 0 ? (
                                                                    <div className="component-search-result-item is-empty">No components found</div>
                                                                ) : filteredComponentSearchResults.map((comp, index) => (
                                                                    <div
                                                                        key={comp.id || comp.name}
                                                                        className={`component-search-result-item ${index === componentSearchIndex ? 'active' : ''}`}
                                                                        onMouseDown={(e) => {
                                                                            e.preventDefault();
                                                                            addGroupMissingInfoComponent(activeGroupDraft.id, comp.name);
                                                                        }}
                                                                    >
                                                                        {comp.name}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <details className="group-advanced" open={showGroupAdvanced}>
                                                    <summary onClick={(event) => {
                                                        event.preventDefault();
                                                        setShowGroupAdvanced(prev => {
                                                            const next = !prev;
                                                            if (!next) {
                                                                setShowGroupImport(false);
                                                            }
                                                            return next;
                                                        });
                                                    }}>
                                                        Advanced
                                                    </summary>
                                                    <div className="group-advanced-body">
                                                        <div className="group-advanced-row">
                                                            <button className="secondary compact" onClick={exportGroupsConfig} type="button">
                                                                Export JSON
                                                            </button>
                                                        </div>
                                                        <div className="group-advanced-row">
                                                            <button
                                                                className="secondary compact"
                                                                onClick={() => {
                                                                    setShowGroupAdvanced(true);
                                                                    setShowGroupImport(true);
                                                                }}
                                                                type="button"
                                                            >
                                                                Import JSON
                                                            </button>
                                                            <span className="group-modal-meta">Import overwrites current draft.</span>
                                                        </div>
                                                        {showGroupImport && (
                                                            <>
                                                                <textarea
                                                                    value={groupImportText}
                                                                    onChange={(event) => setGroupImportText(event.target.value)}
                                                                    placeholder='{"version":1,"groups":[...]}'
                                                                />
                                                                <div className="group-advanced-row">
                                                                    <button className="secondary compact" onClick={importGroupsConfig} type="button">
                                                                        Apply Import
                                                                    </button>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                </details>
                                                <div className="group-danger-zone">
                                                    <div className="group-danger-title">Danger zone</div>
                                                    <button
                                                        className="secondary compact danger"
                                                        onClick={() => removeGroupDraft(activeGroupDraft.id)}
                                                        type="button"
                                                    >
                                                        Delete group
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="group-pane-empty">Select a group to edit, or add a new one.</div>
                                        )}
                                    </div>
                                </div>
                                )}
                                {groupConfigValidationErrors.length > 0 && (
                                    <div className="group-modal-validation" role="alert" aria-live="polite">
                                        {groupConfigValidationErrors.map((message) => (
                                            <div key={message}>• {message}</div>
                                        ))}
                                    </div>
                                )}
                                <div className="group-modal-footer">
                                    <div className="group-modal-button-row">
                                        <button
                                            className="secondary compact"
                                            onClick={testGroupsConfigConnection}
                                            disabled={groupTesting}
                                            type="button"
                                        >
                                            {groupTesting ? 'Testing...' : 'Test configuration'}
                                        </button>
                                        {groupTestMessage && (
                                            <span className="group-modal-meta" aria-live="polite">{groupTestMessage}</span>
                                        )}
                                    </div>
                                    <div className="group-modal-button-row">
                                        <button className="secondary compact lift-hover" onClick={requestCloseGroupManage} type="button">
                                            Cancel
                                        </button>
                                    </div>
                                    <div className="group-modal-button-row">
                                        <button className="compact" onClick={saveGroupsConfig} disabled={Boolean(saveBlockedReason)} title={saveBlockedReason || ''} type="button">
                                            {groupSaving ? 'Saving...' : 'Save'}
                                        </button>
                                    </div>
                                </div>
                                {showGroupDiscardConfirm && (
                                    <div className="group-confirm-backdrop" role="dialog" aria-modal="true" onClick={() => setShowGroupDiscardConfirm(false)}>
                                        <div className="group-confirm" onClick={(event) => event.stopPropagation()}>
                                            <div className="group-confirm-title">Discard changes?</div>
                                    <div className="group-confirm-actions">
                                                <button className="secondary compact danger lift-hover" onClick={discardGroupDraftChanges} type="button">
                                                    Discard
                                                </button>
                                                <button className="compact" onClick={() => setShowGroupDiscardConfirm(false)} type="button">
                                                    Keep editing
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
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
    
