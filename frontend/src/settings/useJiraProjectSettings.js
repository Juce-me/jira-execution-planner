import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { createSettingsDraftReadGuard } from './settingsConfigReadState.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    fetchSelectedProjects as requestSelectedProjects,
    saveSelectedProjects as requestSaveSelectedProjects,
    fetchBoardConfig as requestBoardConfig,
    saveBoardConfig as requestSaveBoardConfig,
    fetchIssueTypesConfig as requestIssueTypesConfig,
    saveIssueTypesConfig as requestSaveIssueTypesConfig,
    fetchAvailableIssueTypes as requestAvailableIssueTypes,
} from '../api/configApi.js';
import {
    fetchProjects as requestJiraProjects,
    searchProjects as requestProjectSearch,
    searchBoards as requestBoardSearch,
    fetchFields as requestJiraFields,
} from '../api/jiraCatalogApi.js';

export function useJiraProjectSettings({
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
}) {
    const [jiraProjects, setJiraProjects] = useState([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [projectSearchQuery, setProjectSearchQuery] = useState('');
    const [projectSearchRemoteResults, setProjectSearchRemoteResults] = useState([]);
    const [projectSearchRemoteLoading, setProjectSearchRemoteLoading] = useState(false);
    const [projectSearchOpen, setProjectSearchOpen] = useState(false);
    const [projectSearchIndex, setProjectSearchIndex] = useState(0);
    const [selectedProjectsDraft, setSelectedProjectsDraft] = useState([]);
    const [savedSelectedProjects, setSavedSelectedProjects] = useState([]);
    const selectedProjectsBaselineRef = useRef('[]');
    const projectSearchInputRef = useRef(null);
    const [boardSearchRemoteResults, setBoardSearchRemoteResults] = useState([]);
    const [boardSearchRemoteLoading, setBoardSearchRemoteLoading] = useState(false);
    const [boardIdDraft, setBoardIdDraft] = useState('');
    // The last-saved board id, distinct from boardIdDraft (the unsaved Admin -> Jira Source
    // input): the Board summaries in Team groups and the Boards tab must not flicker to an
    // unsaved value while an admin edits or clears the field without saving.
    const [savedBoardId, setSavedBoardId] = useState('');
    const [boardNameDraft, setBoardNameDraft] = useState('');
    const boardConfigBaselineRef = useRef('');
    const [boardSearchQuery, setBoardSearchQuery] = useState('');
    const [boardSearchOpen, setBoardSearchOpen] = useState(false);
    const [boardSearchIndex, setBoardSearchIndex] = useState(0);
    const boardSearchInputRef = useRef(null);
    const [jiraFields, setJiraFields] = useState([]);
    const [loadingFields, setLoadingFields] = useState(false);
    const [issueTypesDraft, setIssueTypesDraft] = useState(['Story']);
    const issueTypesBaselineRef = useRef(JSON.stringify(['Story']));
    const [availableIssueTypes, setAvailableIssueTypes] = useState([]);
    const [issueTypeSearchQuery, setIssueTypeSearchQuery] = useState('');
    const [issueTypeSearchOpen, setIssueTypeSearchOpen] = useState(false);
    const [issueTypeSearchIndex, setIssueTypeSearchIndex] = useState(0);
    const issueTypeSearchInputRef = useRef(null);
    const draftSnapshot = {
        projects: JSON.stringify(selectedProjectsDraft),
        board: JSON.stringify({ boardId: boardIdDraft, boardName: boardNameDraft }),
        issueTypes: JSON.stringify(issueTypesDraft),
    };

    const isProjectsDraftDirty = React.useMemo(() => {
        return JSON.stringify(selectedProjectsDraft) !== selectedProjectsBaselineRef.current;
    }, [selectedProjectsDraft, settingsConfigBaselineRevision]);

    const isBoardConfigDirty = React.useMemo(() => Boolean(boardConfigBaselineRef.current) && JSON.stringify({ boardId: boardIdDraft, boardName: boardNameDraft }) !== boardConfigBaselineRef.current, [boardIdDraft, boardNameDraft, settingsConfigBaselineRevision]);

    const isIssueTypesDraftDirty = React.useMemo(() => {
        return JSON.stringify(issueTypesDraft) !== issueTypesBaselineRef.current;
    }, [issueTypesDraft, settingsConfigBaselineRevision]);

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

    const loadSelectedProjects = async ({
        readGeneration = boardConfigReadGenerationRef.current,
        preserveDraft = isProjectsDraftDirty,
    } = {}) => {
        const saveReadFence = boardConfigSaveReadFenceRef.current;
        const shouldApplyResult = () => saveReadFence === 0
            && boardConfigSaveReadFenceRef.current === 0
            && boardConfigReadGenerationRef.current === readGeneration;
        const draftReadGuard = createSettingsDraftReadGuard(() => settingsDraftSnapshotRef.current);
        try {
            const response = await requestSelectedProjects(BACKEND_URL);
            if (!response.ok) throw new Error(`Selected projects fetch error ${response.status}`);
            const data = await response.json();
            if (!shouldApplyResult()) return false;
            const selected = data.selected || [];
            clearServerConnectionError();
            if (!preserveDraft && !draftReadGuard.draftChanged('projects')) setSelectedProjectsDraft(selected);
            setSavedSelectedProjects(selected);
            acceptSettingsConfigBaseline(selectedProjectsBaselineRef, JSON.stringify(selected));
            return true;
        } catch (err) {
            if (!shouldApplyResult()) return false;
            if (isAuthenticationRequiredError(err)) return false;
            if (!reportServerConnectionError(err)) {
                console.error('Failed to load selected projects:', err);
            }
            return false;
        }
    };

    const loadBoardConfig = async ({
        readGeneration = boardConfigReadGenerationRef.current,
        preserveDraft = isBoardConfigDirty,
    } = {}) => {
        const saveReadFence = boardConfigSaveReadFenceRef.current;
        const shouldApplyResult = () => saveReadFence === 0
            && boardConfigSaveReadFenceRef.current === 0
            && boardConfigReadGenerationRef.current === readGeneration;
        const draftReadGuard = createSettingsDraftReadGuard(() => settingsDraftSnapshotRef.current);
        try {
            const response = await requestBoardConfig(BACKEND_URL);
            if (!response.ok) return false;
            const data = await response.json();
            if (!shouldApplyResult()) return false;
            const nextBoardId = String(data.boardId || '');
            const nextBoardName = String(data.boardName || '');
            if (!preserveDraft && !draftReadGuard.draftChanged('board')) {
                setBoardIdDraft(nextBoardId);
                setBoardNameDraft(nextBoardName);
            }
            setSavedBoardId(nextBoardId);
            acceptSettingsConfigBaseline(boardConfigBaselineRef, JSON.stringify({ boardId: nextBoardId, boardName: nextBoardName }));
            return true;
        } catch (err) {
            if (!shouldApplyResult()) return false;
            console.error('Failed to load board config:', err);
            return false;
        }
    };

    const saveBoardConfig = async () => {
        const payload = await requestSaveBoardConfig(
            BACKEND_URL,
            { boardId: boardIdDraft, boardName: boardNameDraft },
            sharedConfigRevisionRef.current,
        );
        commitSharedConfigRevision(payload);
        acceptSettingsConfigBaseline(boardConfigBaselineRef, JSON.stringify({ boardId: boardIdDraft, boardName: boardNameDraft }));
        setSavedBoardId(boardIdDraft);
        return payload;
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
            const payload = await requestSaveSelectedProjects(BACKEND_URL, selectedProjectsDraft, sharedConfigRevisionRef.current);
            commitSharedConfigRevision(payload);
            acceptSettingsConfigBaseline(selectedProjectsBaselineRef, JSON.stringify(selectedProjectsDraft));
            setSavedSelectedProjects([...selectedProjectsDraft]);
        } catch (err) {
            setGroupDraftError(err.message || 'Failed to save project selection.');
            throw err;
        } finally {
            setGroupSaving(false);
        }
    };

    const loadIssueTypesConfig = async ({ shouldApplyDraft = () => true } = {}) => {
        const preserveDraft = isIssueTypesDraftDirty;
        const draftReadGuard = createSettingsDraftReadGuard(() => settingsDraftSnapshotRef.current);
        try {
            const response = await requestIssueTypesConfig(BACKEND_URL);
            if (!response.ok) return;
            const data = await response.json();
            const types = data.issueTypes || ['Story'];
            if (!preserveDraft && !draftReadGuard.draftChanged('issueTypes') && shouldApplyDraft()) {
                setIssueTypesDraft(types);
            }
            acceptSettingsConfigBaseline(issueTypesBaselineRef, JSON.stringify(types));
        } catch (err) {
            console.error('Failed to load issue types config:', err);
        }
    };

    const saveIssueTypesConfig = async () => {
        const payload = await requestSaveIssueTypesConfig(BACKEND_URL, issueTypesDraft, sharedConfigRevisionRef.current);
        commitSharedConfigRevision(payload);
        acceptSettingsConfigBaseline(issueTypesBaselineRef, JSON.stringify(issueTypesDraft));
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

    // Unscoped on purpose: asking the fields endpoint for a project answers from that
    // project's createmeta screens, a strict subset of the instance catalog. Every picker
    // fed by this list configures an instance-wide field, so scoping it hid real ones.
    const fetchJiraFields = async () => {
        setLoadingFields(true);
        try {
            const response = await requestJiraFields(BACKEND_URL, {});
            if (!response.ok) throw new Error(`Fields fetch error ${response.status}`);
            const data = await response.json();
            setJiraFields(data.fields || []);
        } catch (err) {
            console.error('Failed to fetch Jira fields:', err);
        } finally {
            setLoadingFields(false);
        }
    };

    const applyProjectsAndBoardLoaded = (sharedConfig, shouldPreserveSettingsDraft) => {
        const selectedProjects = sharedConfig.projects?.selected || [];
        if (!shouldPreserveSettingsDraft('projects')) setSelectedProjectsDraft(selectedProjects);
        setSavedSelectedProjects(selectedProjects);
        acceptSettingsConfigBaseline(selectedProjectsBaselineRef, JSON.stringify(selectedProjects));
        const board = sharedConfig.board || {};
        const nextBoardId = String(board.boardId || '');
        const nextBoardName = String(board.boardName || '');
        if (!shouldPreserveSettingsDraft('board')) {
            setBoardIdDraft(nextBoardId);
            setBoardNameDraft(nextBoardName);
        }
        setSavedBoardId(nextBoardId);
        acceptSettingsConfigBaseline(boardConfigBaselineRef, JSON.stringify({ boardId: nextBoardId, boardName: nextBoardName }));
    };

    const applyIssueTypesLoaded = (sharedConfig, shouldPreserveSettingsDraft) => {
        const issueTypes = sharedConfig.issueTypes || ['Story'];
        if (!shouldPreserveSettingsDraft('issueTypes')) setIssueTypesDraft(issueTypes);
        acceptSettingsConfigBaseline(issueTypesBaselineRef, JSON.stringify(issueTypes));
    };

    return {
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
        applyProjectsAndBoardLoaded,
        applyIssueTypesLoaded,
        draftSnapshot,
    };
}

export function useJiraProjectSearchEffects({
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
}) {
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
}

export function useJiraProjectCatalogEffects({
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
}) {
    React.useEffect(() => {
        const maxIndex = projectSearchResults.length - 1;
        if (projectSearchIndex > maxIndex) setProjectSearchIndex(0);
    }, [projectSearchResults.length]);

    React.useEffect(() => {
        const maxIndex = boardSearchResults.length - 1;
        if (boardSearchIndex > maxIndex) setBoardSearchIndex(0);
    }, [boardSearchResults.length]);

    React.useEffect(() => {
        if (issueTypeSearchIndex >= issueTypeSearchResults.length) setIssueTypeSearchIndex(0);
    }, [issueTypeSearchResults.length]);

    // Fetch fields when the modal opens. The catalog is instance-wide, so it does not
    // depend on the capacity project draft.
    React.useEffect(() => {
        if (!showGroupManage) return;
        fetchJiraFields();
    }, [showGroupManage]);
}
