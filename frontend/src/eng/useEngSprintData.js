import {
    fetchBacklogEpics as requestBacklogEpics,
    fetchEngTasks,
} from '../api/engApi.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';

export const ENG_TASK_LOAD_OUTCOME = Object.freeze({
    APPLIED: 'applied',
    NON_AUTH_FAILURE: 'non_auth_failure',
    AUTH_REQUIRED: 'auth_required',
    IGNORED: 'ignored',
});
const AUTHENTICATION_REQUIRED_RESULT = ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED;
const NON_AUTH_FAILURE_RESULT = ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE;
const IGNORED_RESULT = ENG_TASK_LOAD_OUTCOME.IGNORED;
import {
    PRIORITY_ORDER,
    filterEpicsByTaskEpicKeys,
    filterEpicsInScopeForTeamSet,
    filterTasksForTeamSet,
    sortTasksByPriority,
} from './engTaskUtils.js';

const OAUTH_ROUTE_NOT_READY_TASKS_MESSAGE = 'OAuth login succeeded, but this dashboard data route has not been migrated to Atlassian OAuth yet.';

async function buildTaskResponseError(response) {
    const errorData = await response.json().catch(() => ({
        error: `HTTP ${response.status}`
    }));
    console.error('Error data:', errorData);
    const error = new Error(errorData.message || errorData.error || `Error ${response.status}`);
    error.code = errorData.error;
    error.loginUrl = errorData.loginUrl;
    error.recoveryUrl = errorData.recoveryUrl;
    error.status = response.status;
    return error;
}

function taskLoadErrorMessage(err, backendUrl) {
    if (err.code === 'route_not_oauth_ready') {
        return `${OAUTH_ROUTE_NOT_READY_TASKS_MESSAGE} Verify OAuth with the auth status and test endpoints, or use Basic auth for the full dashboard until data routes are migrated.`;
    }
    if (err.code === 'missing_project_access') {
        return 'Jira project access is not confirmed for this view. Ask a tool admin to refresh your project access, then retry.';
    }
    if (err.code === 'auth_connection_stale') {
        return 'Your Jira connection changed. I tried refreshing your session, but Jira still needs you to reconnect. Open the reconnect page, then retry.';
    }
    if (err.code === 'auth_connection_revoked') {
        return 'Your Jira connection was revoked. Reconnect Jira to continue.';
    }
    if (err.code === 'account_disabled') {
        return 'Your account is disabled. Contact a tool admin before retrying.';
    }
    if (err.code === 'missing_oauth_scope') {
        return 'Your Jira sign-in needs updated permissions. Sign in with Atlassian again to continue.';
    }
    return `Failed to load tasks: ${err.message}. Make sure the Python server is running on ${backendUrl}`;
}

export function useEngSprintData({
    backendUrl,
    selectedSprint,
    selectedSprintName,
    activeGroupId,
    activeGroupTeamIds,
    activeGroupTeamSet,
    activeGroupTeamLabels,
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
    onServerConnectionFailure,
    onAuthRecoveryRequired,
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
        const requestSignal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
        try {
            const sprintParam = options.sprintOverride !== undefined ? options.sprintOverride : (selectedSprint || '');
            const groupTeamIds = activeGroupTeamIds;
            const groupTeamLabels = Array.from(new Set(groupTeamIds.map((teamId) => String(activeGroupTeamLabels?.[teamId] || '').trim()).filter(Boolean)));
            // Bypass server cache on page load or explicit refresh
            let refresh = false;
            if (pageLoadRefreshRef.current || options.forceRefresh) {
                refresh = true;
                pageLoadRefreshRef.current = false;
            }
            const requestTasks = () => fetchEngTasks(backendUrl, {
                project,
                sprint: sprintParam,
                sprintName: selectedSprintName || '',
                groupId: activeGroupId,
                teamIds: groupTeamIds,
                teamLabels: groupTeamLabels,
                refresh,
                purpose: options.purpose,
                epicKeys: options.epicKeys,
                signal: requestSignal
            });
            const response = await requestTasks();

            console.log('Response status:', response.status);
            console.log('Response ok:', response.ok);

            if (!response.ok) {
                throw await buildTaskResponseError(response);
            }

            const data = await response.json();
            console.log('Success! Received data:', data);

            // Sort by priority
            const sortedTasks = sortTasksByPriority(data.issues || [], priorityOrder);

            const filteredTasks = filterTasksForTeamSet(sortedTasks, activeGroupTeamIds, activeGroupTeamSet);
            const filteredEpicsInScope = filterEpicsInScopeForTeamSet(
                data.epicsInScope || [],
                activeGroupTeamIds,
                activeGroupTeamSet,
                activeGroupTeamLabels
            );
            const filteredEpics = filterEpicsByTaskEpicKeys(data.epics || {}, filteredTasks);
            if (options.shouldApplyResult?.() === false) return IGNORED_RESULT;

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
                return IGNORED_RESULT;
            }
            if (isAuthenticationRequiredError(err)) return AUTHENTICATION_REQUIRED_RESULT;
            if (options.shouldApplyResult?.() === false) return IGNORED_RESULT;
            const handledServerConnection = onServerConnectionFailure?.(err) === true;
            if (setErrors) {
                setError(handledServerConnection ? '' : taskLoadErrorMessage(err, backendUrl));
            }
            if (!handledServerConnection) {
                console.error('Full error details:', err);
            }
            return NON_AUTH_FAILURE_RESULT;
        } finally {
            cleanupSprintFetch(controller);
            if (useLoading && options.shouldApplyResult?.() !== false) {
                setLoading(false);
            }
        }
    };

    const fetchBacklogEpics = async (project, { signal } = {}) => {
        if (!isFutureSprintSelected) return [];
        if (activeGroupId && activeGroupTeamIds.length === 0) return [];
        const payload = await requestBacklogEpics(backendUrl, { project, teamIds: activeGroupTeamIds, signal });
        return Array.isArray(payload.epics) ? payload.epics : [];
    };

    const loadProductTasks = async ({ forceRefresh = false, shouldApplyResult } = {}) => {
        const sprintId = selectedSprint;
        setProductTasksLoading(true);
        try {
            if (activeGroupId && activeGroupTeamIds.length === 0) {
                if (shouldApplyResult?.() === false) return ENG_TASK_LOAD_OUTCOME.IGNORED;
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
                return ENG_TASK_LOAD_OUTCOME.APPLIED;
            }
            const data = await fetchTasks('product', { forceRefresh, shouldApplyResult });
            if (data === AUTHENTICATION_REQUIRED_RESULT) return ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED;
            if (data === NON_AUTH_FAILURE_RESULT) return ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE;
            if (data === IGNORED_RESULT || shouldApplyResult?.() === false) return ENG_TASK_LOAD_OUTCOME.IGNORED;
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
            return ENG_TASK_LOAD_OUTCOME.APPLIED;
        } finally {
            if (shouldApplyResult?.() !== false) {
                setProductTasksLoading(false);
            }
        }
    };

    const loadTechTasks = async ({ forceRefresh = false, shouldApplyResult } = {}) => {
        const sprintId = selectedSprint;
        setTechTasksLoading(true);
        try {
            if (activeGroupId && activeGroupTeamIds.length === 0) {
                if (shouldApplyResult?.() === false) return ENG_TASK_LOAD_OUTCOME.IGNORED;
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
                return ENG_TASK_LOAD_OUTCOME.APPLIED;
            }
            const data = await fetchTasks('tech', { forceRefresh, shouldApplyResult });
            if (data === AUTHENTICATION_REQUIRED_RESULT) return ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED;
            if (data === NON_AUTH_FAILURE_RESULT) return ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE;
            if (data === IGNORED_RESULT || shouldApplyResult?.() === false) return ENG_TASK_LOAD_OUTCOME.IGNORED;
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
            return ENG_TASK_LOAD_OUTCOME.APPLIED;
        } finally {
            if (shouldApplyResult?.() !== false) {
                setTechTasksLoading(false);
            }
        }
    };

    const loadAlertEpics = async ({ forceRefresh = false, shouldApplyResult, signal } = {}) => {
        if (activeGroupId && activeGroupTeamIds.length === 0) {
            return;
        }
        await Promise.all([
            fetchTasks('product', {
                purpose: 'alerts',
                useLoading: false,
                setErrorOnFailure: false,
                forceRefresh,
                shouldApplyResult,
                signal
            }),
            fetchTasks('tech', {
                purpose: 'alerts',
                useLoading: false,
                setErrorOnFailure: false,
                forceRefresh,
                shouldApplyResult,
                signal
            })
        ]);
    };

    const loadReadyToCloseProductTasks = async ({ forceRefresh = false, shouldApplyResult, signal } = {}) => {
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
            forceRefresh,
            shouldApplyResult,
            signal
        });
        if (!Array.isArray(data)) return;
        if (shouldApplyResult?.() === false) return;
        setReadyToCloseProductTasks(data);
    };

    const loadReadyToCloseTechTasks = async ({ forceRefresh = false, shouldApplyResult, signal } = {}) => {
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
            forceRefresh,
            shouldApplyResult,
            signal
        });
        if (!Array.isArray(data)) return;
        if (shouldApplyResult?.() === false) return;
        setReadyToCloseTechTasks(data);
    };

    return {
        fetchTasks,
        fetchBacklogEpics,
        loadProductTasks,
        loadTechTasks,
        loadAlertEpics,
        loadReadyToCloseProductTasks,
        loadReadyToCloseTechTasks,
    };
}
