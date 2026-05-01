import {
    fetchBacklogEpics as requestBacklogEpics,
    fetchEngTasks,
} from '../api/engApi.js';
import {
    PRIORITY_ORDER,
    filterEpicsByTaskEpicKeys,
    filterEpicsInScopeForTeamSet,
    filterTasksForTeamSet,
    sortTasksByPriority,
} from './engTaskUtils.js';

export function useEngSprintData({
    backendUrl,
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
    priorityOrder = PRIORITY_ORDER,
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
}) {
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
            // Bypass server cache on page load or explicit refresh
            let refresh = false;
            if (pageLoadRefreshRef.current || options.forceRefresh) {
                refresh = true;
                pageLoadRefreshRef.current = false;
            }
            const response = await fetchEngTasks(backendUrl, {
                project,
                sprint: sprintParam,
                groupId: activeGroupId,
                teamIds: groupTeamIds,
                refresh,
                purpose: options.purpose,
                epicKeys: options.epicKeys,
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
            const sortedTasks = sortTasksByPriority(data.issues || [], priorityOrder);

            const filteredTasks = filterTasksForTeamSet(sortedTasks, activeGroupTeamIds, activeGroupTeamSet);
            const filteredEpicsInScope = filterEpicsInScopeForTeamSet(
                data.epicsInScope || [],
                activeGroupTeamIds,
                activeGroupTeamSet
            );
            const filteredEpics = filterEpicsByTaskEpicKeys(data.epics || {}, filteredTasks);

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
                const errorMsg = `Failed to load tasks: ${err.message}. Make sure the Python server is running on ${backendUrl}`;
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

    const fetchBacklogEpics = async (project) => {
        if (!isFutureSprintSelected) return [];
        if (activeGroupId && activeGroupTeamIds.length === 0) return [];
        const payload = await requestBacklogEpics(backendUrl, { project, teamIds: activeGroupTeamIds });
        return Array.isArray(payload.epics) ? payload.epics : [];
    };

    const loadProductTasks = async ({ forceRefresh = false } = {}) => {
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
            const data = await fetchTasks('product', { forceRefresh });
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

    const loadTechTasks = async ({ forceRefresh = false } = {}) => {
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
            const data = await fetchTasks('tech', { forceRefresh });
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

    const loadReadyToCloseProductTasks = async ({ forceRefresh = false } = {}) => {
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
            setErrorOnFailure: false,
            forceRefresh
        });
        setReadyToCloseProductTasks(data);
    };

    const loadReadyToCloseTechTasks = async ({ forceRefresh = false } = {}) => {
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
            setErrorOnFailure: false,
            forceRefresh
        });
        setReadyToCloseTechTasks(data);
    };

    return {
        fetchTasks,
        fetchBacklogEpics,
        loadProductTasks,
        loadTechTasks,
        loadReadyToCloseProductTasks,
        loadReadyToCloseTechTasks,
    };
}
