import * as React from 'react';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    fetchEpmProjects,
    fetchEpmProjectRollup,
    fetchEpmAllProjectsRollup,
} from '../api/epmApi.js';
import { classifyEpmReadError, describeEpmReadError } from '../dashboardRuntime.js';
import {
    buildAggregateRollupBoards,
    buildRollupTree,
    filterEpmProjectsForTab,
    filterEpmRollupBoardsForSearch,
    getEpmProjectDisplayName,
    getEpmProjectIdentity,
    normalizeEpmScopeSubGoalKeys,
    sortEpmRollupBoards,
} from './epmProjectUtils.mjs';

const { useState, useEffect, useRef } = React;

function getRuntimeEpmSubGoalKeys(selectedSubGoalKeys, savedSubGoalKeys) {
    const savedKeys = normalizeEpmScopeSubGoalKeys({ subGoalKeys: savedSubGoalKeys });
    const selectedKeys = normalizeEpmScopeSubGoalKeys({ subGoalKeys: selectedSubGoalKeys })
        .filter(key => savedKeys.includes(key));
    if (!selectedKeys.length) return [];
    if (selectedKeys.length === savedKeys.length && selectedKeys.every(key => savedKeys.includes(key))) {
        return [];
    }
    return selectedKeys;
}

export function useEpmViewData({
    backendUrl,
    initialEpmTab = 'active',
    initialEpmSelectedProjectId = '',
    selectedView,
    epmConfigLoaded,
    hasSavedEpmScope,
    savedEpmSubGoalKeys = [],
    selectedSprint,
    epmProjectSearch,
    epmProjectSort,
    searchQuery,
    onHomeAccessDenied,
    onServerConnectionFailure,
}) {
    const [epmTab, setEpmTab] = useState(initialEpmTab ?? 'active');
    const [epmProjects, setEpmProjectsState] = useState([]);
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
    const [epmSelectedSubGoalKeys, setEpmSelectedSubGoalKeys] = useState([]);
    const [epmProjectsAcceptedScope, setEpmProjectsAcceptedScope] = useState('');
    const setEpmProjects = React.useCallback((projects) => {
        setEpmProjectsState(projects);
        setEpmProjectsAcceptedScope('');
    }, []);
    const automaticProjectsRef = useRef(null);
    const automaticRollupScopeRef = useRef('');
    const explicitChecksRef = useRef([]);
    const epmProjectsPendingSelectionRef = useRef(false);
    const epmProjectsRequestIdRef = useRef(0);
    const epmRollupRequestIdRef = useRef(0);
    const epmRollupRetryAfterProjectsRef = useRef(false);
    const normalizedSavedEpmSubGoalKeys = React.useMemo(
        () => normalizeEpmScopeSubGoalKeys({ subGoalKeys: savedEpmSubGoalKeys }),
        [savedEpmSubGoalKeys]
    );
    const runtimeEpmSubGoalKeys = React.useMemo(
        () => getRuntimeEpmSubGoalKeys(epmSelectedSubGoalKeys, normalizedSavedEpmSubGoalKeys),
        [epmSelectedSubGoalKeys, normalizedSavedEpmSubGoalKeys]
    );

    const epmProjectsScopeKey = JSON.stringify([backendUrl, epmTab, normalizedSavedEpmSubGoalKeys, runtimeEpmSubGoalKeys]);
    const epmProjectsLoaded = epmConfigLoaded && hasSavedEpmScope && epmProjectsAcceptedScope === epmProjectsScopeKey;
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
        return sortEpmRollupBoards(filterEpmRollupBoardsForSearch(epmRollupBoards, searchQuery), epmProjectSort);
    }, [epmRollupBoards, epmProjectSort, searchQuery]);
    const invalidateEpmRollupRequest = React.useCallback(() => {
        epmRollupRequestIdRef.current += 1;
        setEpmProjectRollupLoadingIds(new Set());
    }, []);

    const automaticScopeKey = JSON.stringify([epmTab, epmSelectedProjectId, selectedSprint, runtimeEpmSubGoalKeys]);
    const refreshEpmProjects = React.useCallback(async (options = {}) => {
        const background = Boolean(options.background);
        const tab = options.tab || epmTab;
        epmProjectsRequestIdRef.current += 1;
        const requestId = epmProjectsRequestIdRef.current, requestStartedAtMs = Date.now();
        if (!background) {
            epmProjectsPendingSelectionRef.current = true;
        }
        setEpmProjectsLoading(true);
        setEpmProjectsError('');
        try {
            const payload = await fetchEpmProjects(backendUrl, { tab, subGoalKeys: runtimeEpmSubGoalKeys });
            if (epmProjectsRequestIdRef.current !== requestId) {
                return [];
            }
            const nextProjects = Array.isArray(payload.projects) ? payload.projects : [];
            explicitChecksRef.current.push({ source: 'epm_projects', status: 'ok', checkKind: payload.cacheHit === false ? 'forced' : payload.cacheHit === true ? 'cached' : 'unknown', coverage: 'unknown', requestStartedAtMs: requestStartedAtMs });
            setEpmProjects(nextProjects);
            setEpmProjectsAcceptedScope(JSON.stringify([backendUrl, tab, normalizedSavedEpmSubGoalKeys, runtimeEpmSubGoalKeys]));
            return nextProjects;
        } catch (err) {
            if (isAuthenticationRequiredError(err)) throw err;
            if (epmProjectsRequestIdRef.current !== requestId) {
                return [];
            }
            const failure = classifyEpmReadError(err);
            if (failure.invalidateHomeAvailability) onHomeAccessDenied?.(err);
            const handledServerConnection = onServerConnectionFailure?.(err) === true;
            if (!handledServerConnection) {
                console.error('Failed to fetch EPM projects:', err);
            }
            // Throttled or denied reads keep the loaded projects; only a plain failure clears them.
            if (!background && failure.outcome === 'failed') {
                setEpmProjects([]);
            }
            setEpmProjectsError(describeEpmReadError(err, 'Failed to load EPM projects.'));
            return [];
        } finally {
            if (epmProjectsRequestIdRef.current === requestId) {
                if (!background) {
                    epmProjectsPendingSelectionRef.current = false;
                }
                setEpmProjectsLoading(false);
            }
        }
    }, [backendUrl, epmTab, normalizedSavedEpmSubGoalKeys, onHomeAccessDenied, onServerConnectionFailure, runtimeEpmSubGoalKeys, setEpmProjects]);

    const refreshEpmRollup = React.useCallback(async (projectOverride = selectedEpmProject, projectIdOverride = epmSelectedProjectId) => {
        const currentProject = projectOverride || null;
        const currentProjectId = projectIdOverride || getEpmProjectIdentity(currentProject);
        if (selectedView !== 'epm') {
            invalidateEpmRollupRequest();
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
            invalidateEpmRollupRequest();
            setEpmRollupTree(null);
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
            setEpmRollupLoading(false);
            return;
        }
        if (epmTab === 'active' && !selectedSprint) {
            if (!epmRollupRetryAfterProjectsRef.current) {
                setEpmRollupLoading(false);
            }
            return;
        }
        if (epmProjectsPendingSelectionRef.current) {
            epmRollupRetryAfterProjectsRef.current = true;
            setEpmRollupLoading(true);
            return;
        }
        epmRollupRetryAfterProjectsRef.current = false;
        epmRollupRequestIdRef.current += 1;
        const requestId = epmRollupRequestIdRef.current, requestStartedAtMs = Date.now();
        setEpmProjectRollupLoadingIds(new Set());
        if (epmSelectedProjectId === '' && currentProjectId === '') {
            setEpmRollupLoading(true);
            try {
                const payload = await fetchEpmAllProjectsRollup(backendUrl, {
                    tab: epmTab,
                    sprint: selectedSprint,
                    subGoalKeys: runtimeEpmSubGoalKeys,
                });
                if (epmRollupRequestIdRef.current !== requestId) {
                    return;
                }
                explicitChecksRef.current.push({ source: 'epm_rollup', status: 'ok', checkKind: 'unknown', coverage: 'unknown', requestStartedAtMs });
                const aggregate = buildAggregateRollupBoards(payload);
                setEpmRollupTree(null);
                setEpmRollupBoards(aggregate.boards);
                setEpmDuplicates(aggregate.duplicates);
                setEpmAggregateTruncated(aggregate.truncated);
                setEpmAggregateFallback(aggregate.fallback);
            } catch (err) {
                if (isAuthenticationRequiredError(err)) return;
                if (epmRollupRequestIdRef.current !== requestId) {
                    return;
                }
                const failure = classifyEpmReadError(err);
                if (failure.invalidateHomeAvailability) onHomeAccessDenied?.(err);
                const handledServerConnection = onServerConnectionFailure?.(err) === true;
                if (!handledServerConnection) {
                    console.error('Failed to fetch EPM all-projects rollup:', err);
                }
                if (failure.outcome === 'failed') {
                    setEpmRollupBoards(null);
                    setEpmDuplicates({});
                    setEpmAggregateTruncated(false);
                    setEpmAggregateFallback(false);
                }
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
        try {
            const payload = await fetchEpmProjectRollup(backendUrl, currentProjectId, {
                tab: epmTab,
                sprint: selectedSprint,
                subGoalKeys: runtimeEpmSubGoalKeys,
            });
            if (epmRollupRequestIdRef.current !== requestId) {
                return;
            }
            explicitChecksRef.current.push({ source: 'epm_rollup', status: 'ok', checkKind: 'unknown', coverage: 'unknown', requestStartedAtMs });
            setEpmRollupTree(buildRollupTree(payload));
            setEpmRollupBoards(null);
            setEpmDuplicates({});
            setEpmAggregateTruncated(false);
            setEpmAggregateFallback(false);
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            if (epmRollupRequestIdRef.current !== requestId) {
                return;
            }
            const failure = classifyEpmReadError(err);
            if (failure.invalidateHomeAvailability) onHomeAccessDenied?.(err);
            const handledServerConnection = onServerConnectionFailure?.(err) === true;
            if (!handledServerConnection) {
                console.error('Failed to fetch EPM rollup:', err);
            }
            if (failure.outcome === 'failed') setEpmRollupTree(null);
        } finally {
            if (epmRollupRequestIdRef.current === requestId) {
                setEpmRollupLoading(false);
            }
        }
    }, [backendUrl, epmConfigLoaded, epmSelectedProjectId, epmTab, hasSavedEpmScope, invalidateEpmRollupRequest, onHomeAccessDenied, onServerConnectionFailure, runtimeEpmSubGoalKeys, selectedEpmProject, selectedSprint, selectedView]);

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
                subGoalKeys: runtimeEpmSubGoalKeys,
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
            if (isAuthenticationRequiredError(err)) return;
            if (epmRollupRequestIdRef.current === requestId) {
                if (classifyEpmReadError(err).invalidateHomeAvailability) onHomeAccessDenied?.(err);
                const handledServerConnection = onServerConnectionFailure?.(err) === true;
                if (!handledServerConnection) {
                    console.error('Failed to fetch archived EPM project rollup:', err);
                }
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
    }, [backendUrl, epmProjectRollupLoadingIds, epmRollupBoards, epmTab, onHomeAccessDenied, onServerConnectionFailure, runtimeEpmSubGoalKeys, selectedSprint]);

    const refreshEpmView = React.useCallback(async (options = {}) => {
        const job = options.job;
        if (job) {
            const started = Date.now(), checks = [], editState = options.issueEditState;
            const token = editState?.beginRead({ aggregate: true });
            const current = () => job.shouldApply() && !job.signal.aborted && (!editState || editState.isCurrentAggregateRead(token));
            const check = (source, status, checkKind = 'unknown') => ({ source, status, checkKind, coverage: 'unknown', requestStartedAtMs: started, retryAtMs: null });
            try {
                if (!current() || !epmConfigLoaded || !hasSavedEpmScope || (epmTab === 'active' && !selectedSprint)) return job.pendingSources.map(source => check(source, 'ignored'));
                const requestOptions = { tab: epmTab, subGoalKeys: runtimeEpmSubGoalKeys, signal: job.signal, suppressAbortResult: true };
                const metadata = job.pendingSources.includes('epm_projects') ? await fetchEpmProjects(backendUrl, requestOptions) : { projects: epmProjects };
                if (!metadata || !Array.isArray(metadata.projects)) throw new Error('EPM metadata returned no project list');
                if (!current()) return job.pendingSources.map(source => check(source, 'ignored'));
                if (job.pendingSources.includes('epm_projects')) checks.push(check('epm_projects', 'ok', metadata.cacheHit === false ? 'forced' : metadata.cacheHit === true ? 'cached' : 'unknown'));
                const project = filterEpmProjectsForTab(metadata.projects, epmTab).find(value => getEpmProjectIdentity(value) === epmSelectedProjectId);
                const selectedProjectRemoved = Boolean(epmSelectedProjectId && !project);
                const payload = job.pendingSources.includes('epm_rollup') && !selectedProjectRemoved
                    ? epmSelectedProjectId ? await fetchEpmProjectRollup(backendUrl, epmSelectedProjectId, { ...requestOptions, sprint: selectedSprint })
                        : await fetchEpmAllProjectsRollup(backendUrl, { ...requestOptions, sprint: selectedSprint }) : null;
                if (job.pendingSources.includes('epm_rollup') && !selectedProjectRemoved && (!payload || typeof payload !== 'object')) throw new Error('EPM rollup returned no data');
                if (!current()) return job.pendingSources.map(source => check(source, 'ignored'));
                const aggregate = !epmSelectedProjectId && payload ? buildAggregateRollupBoards(payload) : null;
                if (aggregate) {
                    const members = new Map(filterEpmProjectsForTab(metadata.projects, epmTab).map(value => [getEpmProjectIdentity(value), value]));
                    aggregate.boards = aggregate.boards.filter(board => members.has(getEpmProjectIdentity(board.project))).map(board => ({ ...board, project: members.get(getEpmProjectIdentity(board.project)) }));
                    aggregate.duplicates = Object.fromEntries(Object.entries(aggregate.duplicates).map(([key, ids]) => [key, Array.isArray(ids) ? ids.filter(id => members.has(String(id))) : []]).filter(([, ids]) => ids.length > 1));
                }
                const tree = epmSelectedProjectId && payload ? buildRollupTree(payload) : null;
                options.beforeCommit?.(aggregate ? aggregate.boards : [{ project, tree }]);
                // Record the accepted array so its selection effect cannot start a duplicate read or reset the held selection.
                automaticProjectsRef.current = metadata.projects;
                automaticRollupScopeRef.current = automaticScopeKey;
                if (job.pendingSources.includes('epm_projects')) {
                    setEpmProjects(metadata.projects);
                    setEpmProjectsAcceptedScope(epmProjectsScopeKey);
                }
                if (job.pendingSources.includes('epm_rollup')) {
                    setEpmRollupTree(tree);
                    setEpmRollupBoards(aggregate ? aggregate.boards : null);
                    setEpmDuplicates(aggregate ? aggregate.duplicates : {});
                    setEpmAggregateTruncated(Boolean(aggregate?.truncated));
                    setEpmAggregateFallback(Boolean(aggregate?.fallback));
                    checks.push(check('epm_rollup', selectedProjectRemoved ? 'denied' : 'ok'));
                }
                return checks;
            } catch (error) {
                if (isAuthenticationRequiredError(error)) throw error;
                const failure = classifyEpmReadError(error);
                if (current() && failure.invalidateHomeAvailability) onHomeAccessDenied?.(error);
                const status = !current() ? 'ignored' : failure.outcome;
                // Metadata and rollup are one commit; an unsuccessful stage cannot publish a partial project array.
                return job.pendingSources.map(source => check(source, status));
            } finally { if (token) editState.finishRead(token); }
        }
        automaticProjectsRef.current = null;
        explicitChecksRef.current = [];
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
            try {
                await refreshEpmProjects();
            } catch (err) {
                if (isAuthenticationRequiredError(err)) return;
                throw err;
            }
            await refreshEpmRollup(null, '');
            return explicitChecksRef.current;
        }
        let nextProjects;
        try {
            nextProjects = await refreshEpmProjects();
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            throw err;
        }
        const nextVisibleProjects = filterEpmProjectsForTab(nextProjects, epmTab);
        const nextSelectedProject = nextVisibleProjects.find((project) => getEpmProjectIdentity(project) === epmSelectedProjectId) || null;
        await refreshEpmRollup(nextSelectedProject, epmSelectedProjectId);
        return explicitChecksRef.current;
    }, [backendUrl, epmProjects, epmConfigLoaded, epmSelectedProjectId, epmTab, hasSavedEpmScope, onHomeAccessDenied, refreshEpmProjects, refreshEpmRollup, runtimeEpmSubGoalKeys]);

    useEffect(() => {
        setEpmSelectedSubGoalKeys((prev) => {
            const next = normalizeEpmScopeSubGoalKeys({ subGoalKeys: prev })
                .filter(key => normalizedSavedEpmSubGoalKeys.includes(key));
            if (next.length === prev.length && next.every((key, index) => key === prev[index])) {
                return prev;
            }
            return next;
        });
    }, [normalizedSavedEpmSubGoalKeys]);

    useEffect(() => {
        if (selectedView !== 'epm') return;
        if (!epmConfigLoaded) return;
        if (!hasSavedEpmScope) {
            setEpmProjects([]);
            return;
        }
        automaticProjectsRef.current = null;
        void refreshEpmView();
    }, [selectedView, epmConfigLoaded, hasSavedEpmScope, epmSelectedProjectId, epmTab, runtimeEpmSubGoalKeys]);

    useEffect(() => {
        if (selectedView !== 'epm') return;
        if (!epmSelectedProjectId) return;
        if (epmProjectsPendingSelectionRef.current) return;
        if (automaticProjectsRef.current === epmProjects) return;
        if (!epmProjectsLoaded) return;
        if (!selectedEpmProject) {
            setEpmSelectedProjectId('');
        }
    }, [selectedView, epmSelectedProjectId, selectedEpmProject, epmProjectsLoaded]);

    useEffect(() => {
        if (automaticProjectsRef.current === epmProjects && automaticRollupScopeRef.current === automaticScopeKey) return;
        void refreshEpmRollup();
    }, [selectedView, epmConfigLoaded, hasSavedEpmScope, epmSelectedProjectId, selectedEpmProject, epmTab, runtimeEpmSubGoalKeys, selectedSprint]);

    useEffect(() => {
        if (!epmRollupRetryAfterProjectsRef.current) return;
        if (selectedView !== 'epm') return;
        if (epmProjectsLoading || epmProjectsPendingSelectionRef.current) return;
        void refreshEpmRollup();
    }, [selectedView, epmProjectsLoading, refreshEpmRollup]);

    return {
        epmTab,
        setEpmTab,
        epmProjects,
        setEpmProjects,
        epmProjectsLoading,
        epmProjectsLoaded,
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
        epmSelectedSubGoalKeys,
        setEpmSelectedSubGoalKeys,
        runtimeEpmSubGoalKeys,
        refreshEpmProjects,
        refreshEpmRollup,
        refreshEpmView,
        loadArchivedEpmProjectRollup,
    };
}
