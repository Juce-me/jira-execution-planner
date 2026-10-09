import {
    fetchBacklogEpics as requestBacklogEpics,
    fetchEngTasks,
    fetchEpicAlertBundle,
    fetchEpicBacklog as requestEpicBacklog,
    fetchEpicMissingInfo as requestEpicMissingInfo,
    fetchEpicReadyToClose,
    fetchEpicRefresh,
} from '../api/engApi.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { recordPerformanceLoad } from '../api/performanceApi.js';
import { createGroupLoadMeasurement, laneMetrics } from './loadPerformance.js';
import { flattenTeamLabelAliases } from '../settings/groupConfigUtils.js';

export const ENG_TASK_LOAD_OUTCOME = Object.freeze({
    APPLIED: 'applied',
    NON_AUTH_FAILURE: 'non_auth_failure',
    AUTH_REQUIRED: 'auth_required',
    IGNORED: 'ignored',
    ALERT_SCOPE_TOO_LARGE: 'alert_scope_too_large',
    LANE_DENIED: 'lane_denied',
    RATE_LIMITED: 'rate_limited',
});
const AUTHENTICATION_REQUIRED_RESULT = ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED;
const NON_AUTH_FAILURE_RESULT = ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE;
const IGNORED_RESULT = ENG_TASK_LOAD_OUTCOME.IGNORED;
const ALERT_SCOPE_TOO_LARGE_RESULT = ENG_TASK_LOAD_OUTCOME.ALERT_SCOPE_TOO_LARGE;
const ISSUE_EDIT_READ_TOKEN = Symbol('issueEditReadToken');
const EPIC_REFRESH_META = Symbol('epicRefreshMeta');
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
    activeGroupMissingInfoComponents = [],
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
    performanceDebugEnabled = false,
    performanceGate,
    strictBoardActive = false,
    issueEditState,
}) {
    const fetchTasks = async (project, options = {}) => {
        if (strictBoardActive) return IGNORED_RESULT;
        const readToken = issueEditState?.beginRead();
        let tokenRetained = false;
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
        const measured = options.measurement?.enabled === true;
        const startedAt = measured ? performance.now() : 0;
        try {
            const sprintParam = options.sprintOverride !== undefined ? options.sprintOverride : (selectedSprint || '');
            const groupTeamIds = activeGroupTeamIds;
            const groupTeamLabels = groupTeamIds.length ? flattenTeamLabelAliases(activeGroupTeamLabels, groupTeamIds) : [];
            // Bypass server cache on page load or explicit refresh
            let refresh = false;
            if (pageLoadRefreshRef.current || options.forceRefresh) {
                refresh = true;
                pageLoadRefreshRef.current = false;
            }
            const requestTasks = options.epicRefresh
                ? () => (options.epicRequest || fetchEpicRefresh)(backendUrl, {
                    project,
                    sprint: sprintParam,
                    sprintName: selectedSprintName || '',
                    groupId: activeGroupId,
                    teamIds: groupTeamIds,
                    teamLabels: groupTeamLabels,
                    epicKey: options.epicKeys[0],
                    signal: requestSignal,
                })
                : () => fetchEngTasks(backendUrl, {
                    project,
                    sprint: sprintParam,
                    sprintName: selectedSprintName || '',
                    groupId: activeGroupId,
                    teamIds: groupTeamIds,
                    teamLabels: groupTeamLabels,
                    refresh,
                    purpose: options.purpose,
                    epicKeys: options.epicKeys,
                    signal: requestSignal,
                    debugTimings: measured,
                });
            const response = await requestTasks();

            console.log('Response status:', response.status);
            console.log('Response ok:', response.ok);

            if (!response.ok) {
                throw await buildTaskResponseError(response);
            }

            const text = measured ? await response.text() : null;
            const data = measured ? JSON.parse(text) : await response.json();
            if (measured) options.measurement.lane(laneMetrics(project, data, response.headers,
                performance.now() - startedAt, new TextEncoder().encode(text).byteLength));
            console.log('Success! Received data:', data);

            // Raw read, before any reconcile, sort or overlay. The base of an open Planning edit and a write's
            // evidence both come from this raw result, never from an overlaid or projected array.
            const epicEntries = Object.entries(data.epics || {}).map(([key, epic]) => ({ ...epic, key: epic?.key || key }));
            const rawPlanningRead = [...(data.issues || []), ...(data.epicsInScope || []), ...epicEntries];
            issueEditState?.capturePlanningBases(rawPlanningRead, readToken);
            if (options.shouldApplyResult?.() === false) return IGNORED_RESULT;
            issueEditState?.notePlanningRawRead(rawPlanningRead, readToken);
            // Only an explicit operator Refresh may release an unconfirmed lock, and only from this lane's own raw
            // evidence for the lock's own scope. Done before the overlay so a released key shows what Jira returned.
            if (options.operatorRefresh) {
                issueEditState?.releasePlanningLocks({ scope: options.operatorRefresh.scope, evidence: issueEditState.planningEvidence(rawPlanningRead) });
            }

            // Sort by priority; the overlay of pending edits goes on AFTER the sort so a read that lands while an edit is pending
            // never moves the pending Story.
            const reconcile = issues => issueEditState?.reconcileIssues(issues, readToken) || issues;
            const overlay = issues => issueEditState?.overlayPlanningIssues(issues) || issues;
            const sortedTasks = overlay(sortTasksByPriority(reconcile(data.issues || []), priorityOrder));

            const filteredTasks = filterTasksForTeamSet(sortedTasks, activeGroupTeamIds, activeGroupTeamSet);
            const filteredEpicsInScope = filterEpicsInScopeForTeamSet(
                overlay(reconcile(data.epicsInScope || [])),
                activeGroupTeamIds,
                activeGroupTeamSet,
                activeGroupTeamLabels
            );
            const reconciledEpicEntries = overlay(reconcile(epicEntries));
            const filteredEpics = filterEpicsByTaskEpicKeys(Object.fromEntries(reconciledEpicEntries.map(epic => [epic.key, epic])), filteredTasks);
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
            if (readToken) Object.defineProperty(filteredTasks, ISSUE_EDIT_READ_TOKEN, { value: readToken });
            if (options.epicRefresh) {
                Object.defineProperty(filteredTasks, EPIC_REFRESH_META, {
                    value: {
                        epics: Object.fromEntries(reconciledEpicEntries.map(epic => [epic.key, epic])),
                        capped: data.capped === true,
                        epicKeysMissing: Array.isArray(data.epicKeysMissing) ? data.epicKeysMissing : [],
                    },
                });
            }
            tokenRetained = true;
            return filteredTasks;
        } catch (err) {
            if (measured) options.measurement.lane(laneMetrics(project, {}, null, performance.now() - startedAt, 0));
            if (err.name === 'AbortError') {
                return IGNORED_RESULT;
            }
            if (isAuthenticationRequiredError(err)) return AUTHENTICATION_REQUIRED_RESULT;
            if (options.shouldApplyResult?.() === false) return IGNORED_RESULT;
            if (options.purpose === 'alerts' && err.code === 'alert_scope_too_large') return ALERT_SCOPE_TOO_LARGE_RESULT;
            if (options.epicRefresh && err.code === 'missing_project_access') return ENG_TASK_LOAD_OUTCOME.LANE_DENIED;
            if (options.epicRefresh && err.code === 'epic_refresh_rate_limited') return ENG_TASK_LOAD_OUTCOME.RATE_LIMITED;
            const handledServerConnection = !(options.epicRefresh && err.status) && onServerConnectionFailure?.(err) === true;
            if (setErrors) {
                setError(handledServerConnection ? '' : taskLoadErrorMessage(err, backendUrl));
            }
            if (!handledServerConnection) {
                console.error('Full error details:', err);
            }
            return NON_AUTH_FAILURE_RESULT;
        } finally {
            cleanupSprintFetch(controller);
            if (!tokenRetained) issueEditState?.finishRead(readToken);
            if (useLoading && options.shouldApplyResult?.() !== false) {
                setLoading(false);
            }
        }
    };

    const fetchBacklogEpics = async (project, { signal } = {}) => {
        if (strictBoardActive) return [];
        if (!isFutureSprintSelected) return [];
        if (activeGroupId && activeGroupTeamIds.length === 0) return [];
        const payload = await requestBacklogEpics(backendUrl, { project, teamIds: activeGroupTeamIds, signal });
        return Array.isArray(payload.epics) ? payload.epics : [];
    };

    const loadProductTasks = async ({ forceRefresh = false, shouldApplyResult, measurement, operatorRefresh } = {}) => {
        if (strictBoardActive) return ENG_TASK_LOAD_OUTCOME.IGNORED;
        const sprintId = selectedSprint;
        setProductTasksLoading(true);
        let retainedReadToken;
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
            const data = await fetchTasks('product', { forceRefresh, shouldApplyResult, measurement, operatorRefresh });
            const readToken = data?.[ISSUE_EDIT_READ_TOKEN]; retainedReadToken = readToken;
            if (data === AUTHENTICATION_REQUIRED_RESULT) return ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED;
            if (data === NON_AUTH_FAILURE_RESULT) return ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE;
            if (data === IGNORED_RESULT || shouldApplyResult?.() === false) {
                return ENG_TASK_LOAD_OUTCOME.IGNORED;
            }
            const reconciled = issueEditState?.reconcileIssues(data, readToken) || data;
            setProductTasks(reconciled);
            setLoadedProductTasks(reconciled);
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
            issueEditState?.finishRead(retainedReadToken);
            if (shouldApplyResult?.() !== false) {
                setProductTasksLoading(false);
            }
        }
    };

    const loadTechTasks = async ({ forceRefresh = false, shouldApplyResult, measurement, operatorRefresh } = {}) => {
        if (strictBoardActive) return ENG_TASK_LOAD_OUTCOME.IGNORED;
        const sprintId = selectedSprint;
        setTechTasksLoading(true);
        let retainedReadToken;
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
            const data = await fetchTasks('tech', { forceRefresh, shouldApplyResult, measurement, operatorRefresh });
            const readToken = data?.[ISSUE_EDIT_READ_TOKEN]; retainedReadToken = readToken;
            if (data === AUTHENTICATION_REQUIRED_RESULT) return ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED;
            if (data === NON_AUTH_FAILURE_RESULT) return ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE;
            if (data === IGNORED_RESULT || shouldApplyResult?.() === false) {
                return ENG_TASK_LOAD_OUTCOME.IGNORED;
            }
            const reconciled = issueEditState?.reconcileIssues(data, readToken) || data;
            setTechTasks(reconciled);
            setLoadedTechTasks(reconciled);
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
            issueEditState?.finishRead(retainedReadToken);
            if (shouldApplyResult?.() !== false) {
                setTechTasksLoading(false);
            }
        }
    };

    const loadAlertEpics = async ({ forceRefresh = false, shouldApplyResult, signal } = {}) => {
        if (strictBoardActive) return ENG_TASK_LOAD_OUTCOME.IGNORED;
        if (activeGroupId && activeGroupTeamIds.length === 0) {
            return;
        }
        const results = await Promise.all([
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
        results.forEach(result => issueEditState?.finishRead(result?.[ISSUE_EDIT_READ_TOKEN]));
        const toAlertOutcome = result => (typeof result === 'string' ? result : ENG_TASK_LOAD_OUTCOME.APPLIED);
        return { product: toAlertOutcome(results[0]), tech: toAlertOutcome(results[1]) };
    };

    const loadReadyToCloseProductTasks = async ({ forceRefresh = false, shouldApplyResult, signal } = {}) => {
        if (strictBoardActive) return ENG_TASK_LOAD_OUTCOME.IGNORED;
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
        const readToken = data?.[ISSUE_EDIT_READ_TOKEN];
        try {
            if (!Array.isArray(data)) return;
            if (shouldApplyResult?.() === false) return;
            setReadyToCloseProductTasks(issueEditState?.reconcileIssues(data, readToken) || data);
        } finally {
            issueEditState?.finishRead(readToken);
        }
    };

    const loadReadyToCloseTechTasks = async ({ forceRefresh = false, shouldApplyResult, signal } = {}) => {
        if (strictBoardActive) return ENG_TASK_LOAD_OUTCOME.IGNORED;
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
        const readToken = data?.[ISSUE_EDIT_READ_TOKEN];
        try {
            if (!Array.isArray(data)) return;
            if (shouldApplyResult?.() === false) return;
            setReadyToCloseTechTasks(issueEditState?.reconcileIssues(data, readToken) || data);
        } finally {
            issueEditState?.finishRead(readToken);
        }
    };

    const loadGroupTasks = (options = {}) => {
        if (strictBoardActive) {
            const ignored = Promise.resolve(ENG_TASK_LOAD_OUTCOME.IGNORED);
            return {
                product: ignored,
                tech: ignored,
                primaryReady: false,
                dependenciesFinished: () => {},
                cancel: () => {},
            };
        }
        const measurement = createGroupLoadMeasurement({ enabled: (performanceGate?.enabled ?? performanceDebugEnabled) && Boolean(activeGroupId) && activeGroupTeamIds.length > 0,
            groupId: activeGroupId, sprintId: selectedSprint,
            emit: async sample => {
                if (performanceGate) {
                    await performanceGate.ready;
                    if (!performanceGate.enabled) return;
                }
                return recordPerformanceLoad(backendUrl, sample);
            } });
        const product = loadProductTasks({ ...options, measurement });
        const tech = loadTechTasks({ ...options, measurement });
        for (const lane of [product, tech]) {
            void lane.then(outcome => {
                if (outcome === ENG_TASK_LOAD_OUTCOME.APPLIED) return measurement.contentReady();
            }).catch(() => {});
        }
        let resolveDependencies;
        let primaryReady = false;
        const dependencies = options.waitForDependencies && measurement.enabled
            ? new Promise(resolve => { resolveDependencies = resolve; }) : Promise.resolve('applied');
        void Promise.all([product, tech]).then(async outcomes => {
            primaryReady = outcomes.every(value => value === ENG_TASK_LOAD_OUTCOME.APPLIED);
            if (primaryReady) options.onPrimaryReady?.();
            if (outcomes.every(value => value === ENG_TASK_LOAD_OUTCOME.APPLIED)) outcomes.push(await dependencies);
            return measurement.finish(outcomes);
        },
            () => measurement.finish([ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE]));
        return { product, tech,
            get primaryReady() { return primaryReady; },
            dependenciesFinished: (outcome = 'applied', durationMs = 0) => {
                measurement.dependencies(durationMs);
                resolveDependencies?.(outcome);
            },
            cancel: () => { measurement.cancel(); resolveDependencies?.('ignored'); } };
    };

    // One lane of one epic-scoped alert request. The scope list is captured by a setter of our own: the department loader applies it
    // wholesale, which would wipe the other epics. HTTP failures never reach the global connection-failure handler (`epicRefresh`).
    const fetchAlertLane = async (project, { epicKey, signal, epicRequest }) => {
        let epicsInScope = [];
        const data = await fetchTasks(project, {
            epicRefresh: true,
            epicRequest,
            epicsInScopeSetter: list => { epicsInScope = list; },
            epicKeys: [epicKey],
            updateEpics: false,
            useLoading: false,
            setErrorOnFailure: false,
            forceRefresh: true,
            signal,
        });
        const readToken = data?.[ISSUE_EDIT_READ_TOKEN];
        try {
            if (Array.isArray(data)) return { status: 'ok', items: data, epicsInScope };
            if (data === ENG_TASK_LOAD_OUTCOME.LANE_DENIED) return { status: 'denied' };
            if (data === ENG_TASK_LOAD_OUTCOME.RATE_LIMITED) return { status: 'rate_limited' };
            if (data === ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED) return { status: 'auth_required' };
            if (data === ENG_TASK_LOAD_OUTCOME.IGNORED) return { status: 'ignored' };
            return { status: 'failed' };
        } finally {
            issueEditState?.finishRead(readToken);
        }
    };

    // Missing Info (one department-wide request) and Backlog (one per lane) for one epic. Same shape as the lanes above; an HTTP failure
    // is `failed`, a real auth lock is `auth_required`, and neither reaches the global connection-failure handler.
    const fetchEpicSideLane = async (load) => {
        const controller = registerSprintFetch();
        const readToken = issueEditState?.beginRead();
        const reconcile = list => issueEditState?.reconcileIssues(list, readToken) || list;
        try {
            return await load(controller.signal, reconcile);
        } catch (error) {
            if (isAuthenticationRequiredError(error)) return { status: 'auth_required' };
            return { status: error?.name === 'AbortError' ? 'ignored' : 'failed' };
        } finally {
            issueEditState?.finishRead(readToken);
            cleanupSprintFetch(controller);
        }
    };
    const fetchEpicMissingInfoLane = ({ epicKey, signal }) => {
        if (!selectedSprint || (activeGroupId && activeGroupTeamIds.length === 0)) return { status: 'ignored' };
        return fetchEpicSideLane(async (laneSignal, reconcile) => {
            const response = await requestEpicMissingInfo(backendUrl, {
                sprintId: selectedSprint, teamIds: activeGroupTeamIds, components: activeGroupMissingInfoComponents, epicKey,
                signal: signal ? AbortSignal.any([laneSignal, signal]) : laneSignal,
            });
            if (!response.ok) return { status: 'failed' };
            const data = await response.json();
            return { status: 'ok', issues: reconcile(data.issues || []), epics: reconcile(data.epics || []) };
        });
    };
    const fetchEpicBacklogLane = (project, { epicKey, signal }) => {
        if (!isFutureSprintSelected || (activeGroupId && activeGroupTeamIds.length === 0)) return { status: 'ignored' };
        return fetchEpicSideLane(async (laneSignal, reconcile) => {
            const payload = await requestEpicBacklog(backendUrl, {
                project, teamIds: activeGroupTeamIds, epicKey, signal: signal ? AbortSignal.any([laneSignal, signal]) : laneSignal,
            });
            return { status: 'ok', epics: reconcile(Array.isArray(payload?.epics) ? payload.epics : []) };
        });
    };

    // Scope-based alerts for one epic (issue #213): both lanes per requested call, results handed back unapplied.
    // Returns { product: { epicAlerts?, readyToClose?, backlog?: Lane }, tech: { ... }, missingInfo?: { status, issues?, epics? } };
    // Lane has `epicsInScope` (and `items` for readyToClose, `epics` for backlog).
    const loadEpicAlerts = async ({ epicKey, calls = [], signal } = {}) => {
        const requests = { epicAlerts: fetchEpicAlertBundle, readyToClose: fetchEpicReadyToClose };
        const lanes = { product: {}, tech: {} };
        if (strictBoardActive) return lanes;
        const wants = call => calls.includes(call);
        await Promise.all([
            ...Object.keys(requests).filter(wants).flatMap(call => ['product', 'tech'].map(async project => {
                lanes[project][call] = await fetchAlertLane(project, { epicKey, signal, epicRequest: requests[call] });
            })),
            ...(wants('backlog') ? ['product', 'tech'].map(async project => { lanes[project].backlog = await fetchEpicBacklogLane(project, { epicKey, signal }); }) : []),
            ...(wants('missingInfo') ? [(async () => { lanes.missingInfo = await fetchEpicMissingInfoLane({ epicKey, signal }); })()] : []),
        ]);
        return lanes;
    };

    // Per-epic refresh (issue #213): both lanes, no loading flag, results handed back for one atomic apply.
    const loadEpicRefresh = async ({ epicKey, shouldApplyResult, signal } = {}) => {
        if (strictBoardActive) return { product: { status: 'ignored' }, tech: { status: 'ignored' } };
        const fetchLane = async project => {
            const data = await fetchTasks(project, {
                epicRefresh: true,
                epicKeys: [epicKey],
                updateEpics: false,
                useLoading: false,
                setErrorOnFailure: false,
                forceRefresh: true,
                shouldApplyResult,
                signal,
            });
            const readToken = data?.[ISSUE_EDIT_READ_TOKEN];
            try {
                if (Array.isArray(data)) return { status: 'ok', items: data, meta: data[EPIC_REFRESH_META] };
                if (data === ENG_TASK_LOAD_OUTCOME.LANE_DENIED) return { status: 'denied' };
                if (data === ENG_TASK_LOAD_OUTCOME.RATE_LIMITED) return { status: 'rate_limited' };
                if (data === ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED) return { status: 'auth_required' };
                if (data === ENG_TASK_LOAD_OUTCOME.IGNORED) return { status: 'ignored' };
                return { status: 'failed' };
            } finally {
                issueEditState?.finishRead(readToken);
            }
        };
        const [product, tech] = await Promise.all([fetchLane('product'), fetchLane('tech')]);
        return { product, tech };
    };

    return {
        loadGroupTasks,
        loadEpicRefresh,
        loadEpicAlerts,
        fetchTasks,
        fetchBacklogEpics,
        loadProductTasks,
        loadTechTasks,
        loadAlertEpics,
        loadReadyToCloseProductTasks,
        loadReadyToCloseTechTasks,
    };
}
