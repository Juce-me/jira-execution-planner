import * as React from 'react';
import {
    fetchEpmProjects,
    fetchEpmProjectRollup,
    fetchEpmAllProjectsRollup,
} from '../api/epmApi.js';
import {
    buildAggregateRollupBoards,
    buildRollupTree,
    filterEpmProjectsForTab,
    filterEpmRollupBoardsForSearch,
    getEpmProjectDisplayName,
    getEpmProjectIdentity,
} from './epmProjectUtils.mjs';

const { useState, useEffect, useRef } = React;

export function useEpmViewData({
    backendUrl,
    initialEpmTab = 'active',
    initialEpmSelectedProjectId = '',
    selectedView,
    epmConfigLoaded,
    hasSavedEpmScope,
    selectedSprint,
    epmProjectSearch,
    searchQuery,
}) {
    const [epmTab, setEpmTab] = useState(initialEpmTab ?? 'active');
    const [epmProjects, setEpmProjects] = useState([]);
    const [epmProjectsLoading, setEpmProjectsLoading] = useState(false);
    const [epmProjectsError, setEpmProjectsError] = useState('');
    const [epmSelectedProjectId, setEpmSelectedProjectId] = useState(initialEpmSelectedProjectId ?? '');
    const [epmRollupTree, setEpmRollupTree] = useState(null);
    const [epmRollupBoards, setEpmRollupBoards] = useState(null);
    const [epmDuplicates, setEpmDuplicates] = useState({});
    const [epmAggregateTruncated, setEpmAggregateTruncated] = useState(false);
    const [epmAggregateFallback, setEpmAggregateFallback] = useState(false);
    const [epmRollupLoading, setEpmRollupLoading] = useState(false);
    const [epmProjectRollupLoadingIds, setEpmProjectRollupLoadingIds] = useState(() => new Set());
    const epmProjectsPendingSelectionRef = useRef(false);
    const epmProjectsRequestIdRef = useRef(0);
    const epmRollupRequestIdRef = useRef(0);

    // filterEpmProjectsForTab owns the `project.tabBucket === epmTab` check.
    const visibleEpmProjects = React.useMemo(() => filterEpmProjectsForTab(epmProjects, epmTab), [epmProjects, epmTab]);
    const selectedEpmProject = visibleEpmProjects.find((project) => getEpmProjectIdentity(project) === epmSelectedProjectId) || null;
    const filteredEpmProjects = React.useMemo(() => {
        const query = epmProjectSearch.trim().toLowerCase();
        const projects = visibleEpmProjects.filter(project => getEpmProjectIdentity(project));
        if (!query) return projects;
        return projects.filter(project => {
            const projectId = getEpmProjectIdentity(project).toLowerCase();
            const name = getEpmProjectDisplayName(project).toLowerCase();
            const label = String(project?.label || '').toLowerCase();
            return projectId.includes(query) || name.includes(query) || label.includes(query);
        });
    }, [visibleEpmProjects, epmProjectSearch]);
    const visibleEpmRollupBoards = React.useMemo(() => {
        if (!Array.isArray(epmRollupBoards)) return epmRollupBoards;
        return filterEpmRollupBoardsForSearch(epmRollupBoards, searchQuery);
    }, [epmRollupBoards, searchQuery]);

    const refreshEpmProjects = React.useCallback(async (options = {}) => {
        const background = Boolean(options.background);
        const tab = options.tab || epmTab;
        epmProjectsRequestIdRef.current += 1;
        const requestId = epmProjectsRequestIdRef.current;
        if (!background) {
            epmProjectsPendingSelectionRef.current = true;
        }
        setEpmProjectsLoading(true);
        setEpmProjectsError('');
        try {
            const payload = await fetchEpmProjects(backendUrl, { tab });
            if (epmProjectsRequestIdRef.current !== requestId) {
                return [];
            }
            const nextProjects = Array.isArray(payload.projects) ? payload.projects : [];
            setEpmProjects(nextProjects);
            return nextProjects;
        } catch (err) {
            if (epmProjectsRequestIdRef.current !== requestId) {
                return [];
            }
            console.error('Failed to fetch EPM projects:', err);
            if (!background) {
                setEpmProjects([]);
            }
            setEpmProjectsError(err?.message || 'Failed to load EPM projects.');
            return [];
        } finally {
            if (epmProjectsRequestIdRef.current === requestId) {
                if (!background) {
                    epmProjectsPendingSelectionRef.current = false;
                }
                setEpmProjectsLoading(false);
            }
        }
    }, [backendUrl, epmTab]);

    const refreshEpmRollup = React.useCallback(async (projectOverride = selectedEpmProject, projectIdOverride = epmSelectedProjectId) => {
        epmRollupRequestIdRef.current += 1;
        const requestId = epmRollupRequestIdRef.current;
        const currentProject = projectOverride || null;
        const currentProjectId = projectIdOverride || getEpmProjectIdentity(currentProject);
        setEpmProjectRollupLoadingIds(new Set());
        if (selectedView !== 'epm') {
            setEpmRollupTree(null);
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
            setEpmRollupLoading(false);
            return;
        }
        if (!epmConfigLoaded) {
            setEpmRollupLoading(false);
            return;
        }
        if (!hasSavedEpmScope) {
            setEpmRollupTree(null);
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
            setEpmRollupLoading(false);
            return;
        }
        if (epmProjectsPendingSelectionRef.current) {
            return;
        }
        if (epmTab === 'active' && !selectedSprint) {
            setEpmRollupTree(null);
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
            setEpmRollupLoading(false);
            return;
        }
        if (epmSelectedProjectId === '' && currentProjectId === '') {
            setEpmRollupLoading(true);
            setEpmRollupTree(null);
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
            try {
                const payload = await fetchEpmAllProjectsRollup(backendUrl, {
                    tab: epmTab,
                    sprint: selectedSprint,
                });
                if (epmRollupRequestIdRef.current !== requestId) {
                    return;
                }
                const aggregate = buildAggregateRollupBoards(payload);
                setEpmRollupBoards(aggregate.boards);
                setEpmDuplicates(aggregate.duplicates);
                setEpmAggregateTruncated(aggregate.truncated);
                setEpmAggregateFallback(aggregate.fallback);
            } catch (err) {
                if (epmRollupRequestIdRef.current !== requestId) {
                    return;
                }
                console.error('Failed to fetch EPM all-projects rollup:', err);
                setEpmRollupBoards(null);
                setEpmDuplicates({});
                setEpmAggregateTruncated(false);
                setEpmAggregateFallback(false);
            } finally {
                if (epmRollupRequestIdRef.current === requestId) {
                    setEpmRollupLoading(false);
                }
            }
            return;
        }
        if (!currentProject) {
            setEpmRollupTree(null);
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
            setEpmRollupLoading(false);
            return;
        }
        if (currentProject.matchState === 'metadata-only' && !currentProject.label) {
            setEpmRollupTree(buildRollupTree({ metadataOnly: true }));
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
            setEpmRollupLoading(false);
            return;
        }
        setEpmRollupLoading(true);
        setEpmRollupTree(null);
        setEpmRollupBoards(null);
        setEpmDuplicates({});
        setEpmAggregateTruncated(false);
        setEpmAggregateFallback(false);
        try {
            const payload = await fetchEpmProjectRollup(backendUrl, currentProjectId, {
                tab: epmTab,
                sprint: selectedSprint,
            });
            if (epmRollupRequestIdRef.current !== requestId) {
                return;
            }
            setEpmRollupTree(buildRollupTree(payload));
        } catch (err) {
            if (epmRollupRequestIdRef.current !== requestId) {
                return;
            }
            console.error('Failed to fetch EPM rollup:', err);
            setEpmRollupTree(null);
        } finally {
            if (epmRollupRequestIdRef.current === requestId) {
                setEpmRollupLoading(false);
            }
        }
    }, [backendUrl, epmConfigLoaded, epmSelectedProjectId, epmTab, hasSavedEpmScope, selectedEpmProject, selectedSprint, selectedView]);

    const loadArchivedEpmProjectRollup = React.useCallback(async (project) => {
        if (epmTab !== 'archived') return;
        const projectId = getEpmProjectIdentity(project);
        if (!projectId || !project?.label) return;
        const currentBoard = (epmRollupBoards || []).find((board) => getEpmProjectIdentity(board?.project) === projectId);
        if (currentBoard?.tree?.kind === 'tree' || currentBoard?.tree?.kind === 'emptyRollup') return;
        if (epmProjectRollupLoadingIds.has(projectId)) return;
        const requestId = epmRollupRequestIdRef.current;
        setEpmProjectRollupLoadingIds((prev) => {
            const next = new Set(prev);
            next.add(projectId);
            return next;
        });
        try {
            const payload = await fetchEpmProjectRollup(backendUrl, projectId, {
                tab: epmTab,
                sprint: selectedSprint,
            });
            if (epmRollupRequestIdRef.current !== requestId) {
                return;
            }
            const tree = buildRollupTree(payload);
            setEpmRollupBoards((prev) => Array.isArray(prev)
                ? prev.map((board) => (
                    getEpmProjectIdentity(board?.project) === projectId
                        ? { ...board, tree }
                        : board
                ))
                : prev);
        } catch (err) {
            if (epmRollupRequestIdRef.current === requestId) {
                console.error('Failed to fetch archived EPM project rollup:', err);
            }
        } finally {
            if (epmRollupRequestIdRef.current === requestId) {
                setEpmProjectRollupLoadingIds((prev) => {
                    const next = new Set(prev);
                    next.delete(projectId);
                    return next;
                });
            }
        }
    }, [backendUrl, epmProjectRollupLoadingIds, epmRollupBoards, epmTab, selectedSprint]);

    const refreshEpmView = React.useCallback(async () => {
        if (!epmConfigLoaded) {
            setEpmProjectsLoading(false);
            setEpmRollupLoading(false);
            return;
        }
        if (!hasSavedEpmScope) {
            setEpmProjects([]);
            setEpmRollupTree(null);
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
            setEpmRollupLoading(false);
            return;
        }
        if (epmSelectedProjectId === '') {
            await refreshEpmProjects();
            await refreshEpmRollup(null, '');
            return;
        }
        const nextProjects = await refreshEpmProjects();
        const nextVisibleProjects = filterEpmProjectsForTab(nextProjects, epmTab);
        const nextSelectedProject = nextVisibleProjects.find((project) => getEpmProjectIdentity(project) === epmSelectedProjectId) || null;
        await refreshEpmRollup(nextSelectedProject, epmSelectedProjectId);
    }, [epmConfigLoaded, epmSelectedProjectId, epmTab, hasSavedEpmScope, refreshEpmProjects, refreshEpmRollup]);

    useEffect(() => {
        if (selectedView !== 'epm') return;
        if (!epmConfigLoaded) return;
        if (!hasSavedEpmScope) {
            setEpmProjects([]);
            return;
        }
        void refreshEpmView();
    }, [selectedView, epmConfigLoaded, hasSavedEpmScope, epmSelectedProjectId, epmTab]);

    useEffect(() => {
        if (selectedView !== 'epm') return;
        if (!epmSelectedProjectId) return;
        if (epmProjectsPendingSelectionRef.current) return;
        if (!selectedEpmProject) {
            setEpmSelectedProjectId('');
        }
    }, [selectedView, epmSelectedProjectId, selectedEpmProject]);

    useEffect(() => {
        void refreshEpmRollup();
    }, [selectedView, epmConfigLoaded, hasSavedEpmScope, epmSelectedProjectId, selectedEpmProject, epmTab, selectedSprint]);

    return {
        epmTab,
        setEpmTab,
        epmProjects,
        setEpmProjects,
        epmProjectsLoading,
        epmProjectsError,
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
        epmAggregateFallback,
        epmRollupLoading,
        epmProjectRollupLoadingIds,
        refreshEpmProjects,
        refreshEpmRollup,
        refreshEpmView,
        loadArchivedEpmProjectRollup,
    };
}
