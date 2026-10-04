import * as React from 'react';
import { parseScenarioDate, normalizeScenarioSummary, applyIssueOverride, pxToDate, dateToISODate, validateDependencies, splitAtSprintBoundaries, SCENARIO_BAR_HEIGHT, SCENARIO_BAR_GAP, SCENARIO_COLLAPSED_ROWS, SCENARIO_TEAM_LEAD_ROWS } from './scenarioUtils.js';
import { normalizeScenarioDraftOverrides } from './scenarioDraftOverrides.js';
import { useScenarioDraft } from './useScenarioDraft.js';
import { buildLaneIssues } from './scenarioLaneUtils.js';
import { AUTH_REQUIRED_EVENT, isAuthenticationRequiredError, readPendingAuthenticationRequired } from '../api/authRequired.js';
import { buildScenarioDraftEventsStreamUrl } from '../api/scenarioApi.js';
import { bucketCount } from '../analytics/dashboardAnalytics.js';
import { collectJiraExportKeysFromScenarioIssues } from '../jiraExportUtils.mjs';
import { useEffect } from 'react';

export function useScenarioPlanner({
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
}) {
    const {
        scenarioCurrentUserIdentity,
        setScenarioCurrentUserIdentity,
        scenarioData,
        scenarioLaneMode,
        setScenarioLaneMode,
        scenarioShowConflictsOnly,
        scenarioTimelineRef,
        scenarioLayout,
        setScenarioLayout,
        scenarioCollapsedLanes,
        setScenarioCollapsedLanes,
        scenarioHoverKey,
        setScenarioFlashKey,
        scenarioScrollTop,
        setScenarioScrollTop,
        setScenarioScrollLeft,
        scenarioViewportHeight,
        setScenarioViewportHeight,
        scenarioEpicFocus,
        setScenarioEpicFocus,
        scenarioRangeOverride,
        setScenarioRangeOverride,
        scenarioFocusRestoreRef,
        scenarioSkipAutoCollapseRef,
        scenarioTeamCollapseInitRef,
        scenarioHistoryButtonRef,
        scenarioHistoryPanelRef,
        scenarioHistoryTitleRef,
        scenarioOverrides,
        setScenarioOverrides,
        scenarioActiveDraftIdRef,
        scenarioScopeKeyRef,
        scenarioDraftMeta,
        setScenarioDraftMeta,
        setScenarioDraftEvents,
        scenarioDraftPresence,
        setScenarioDraftPresence,
        scenarioDraftLocks,
        setScenarioDraftLocks,
        scenarioDraftRealtimeStatus,
        setScenarioDraftRealtimeStatus,
        scenarioDraftLastEventNumber,
        setScenarioDraftLastEventNumber,
        scenarioEditMode,
        setScenarioEditMode,
        scenarioUndoStackRef,
        setScenarioUndoVersion,
        scenarioDragState,
        setScenarioDragState,
        scenarioDragStateRef,
        scenarioDragFrameRef,
        scenarioDragLockRefreshRef,
        scenarioHistoryRefreshControllerRef,
        scenarioHistoryActionControllerRef,
        scenarioViewRangeRef,
        scenarioWasDraggedRef,
        scenarioEdgeUpdatePendingRef,
        scenarioEdgeFrameRef,
        scenarioScrollFrameRef,
        scenarioResizeFrameRef,
        scenarioPendingScrollRef,
        setScenarioTooltip,
        scenarioTooltipRef,
        scenarioTooltipAnchorRef,
        scenarioIssueRefMap,
        setScenarioEdgeRender,
    } = scenarioState;
    let scheduleScenarioEdgeUpdate;

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

    const {
        fetchScenarioDraft,
        pauseScenarioRealtime,
        postScenarioRealtimeJson,
        pollScenarioDraftEvents,
        saveScenarioDraftVersion,
        fetchScenarioDraftVersion,
        rollbackScenarioDraft,
        reloadScenarioDraftFromJira,
        buildScenarioDraftScope,
        runScenario,
        scenarioScopeKey,
        scenarioHasUnsavedChanges,
        scenarioCanSaveDraft,
        scenarioActiveDraftId,
        isScenarioScopeDraftCurrent,
        scenarioActiveDraftReady,
    } = useScenarioDraft({
        scenarioState,
        BACKEND_URL,
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
        showScenario,
        pendingShellAuthResumeRef,
        selectedSprintInfo,
        trackScenarioAction,
        visibleControlGroups,
        selectedSprintState,
        isCompletedSprintSelected,
        registerSprintFetch,
        cleanupSprintFetch,
        activeGroup,
        teamOptions,
        selectedTeamSet,
        isAllTeamsSelected,
        excludedEpicSet,
    });

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

    const toggleScenarioEditMode = () => {
        setScenarioEditMode(prev => {
            trackScenarioAction(prev ? 'edit_stop' : 'edit_start', { dirty_state: scenarioHasUnsavedChanges ? 'dirty' : 'clean' });
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
            if (isAuthenticationRequiredError(err)) return;
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
            if (isAuthenticationRequiredError(err)) return;
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
            if (isAuthenticationRequiredError(err)) return;
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

    const scenarioRawIssues = scenarioData?.issues || EMPTY_ARRAY;
    const scenarioConfig = scenarioData?.config || EMPTY_OBJECT;
    const scenarioSummary = scenarioData?.summary || EMPTY_OBJECT;
    const scenarioBaseUrl = scenarioData?.jira_base_url || jiraUrl || '';
    const scenarioDependencies = scenarioData?.dependencies || EMPTY_ARRAY;
    const scenarioCapacityByTeam = scenarioData?.capacity_by_team || EMPTY_OBJECT;
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
            if (readPendingAuthenticationRequired()) return;
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
                if (isAuthenticationRequiredError(err)) return;
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
            if (readPendingAuthenticationRequired()) return;
            try {
                await postScenarioRealtimeJson(scenarioActiveDraftId, '/presence', {
                    mode: scenarioEditMode ? 'editing' : 'viewing',
                    cursorPayload: {}
                }).then(data => learnScenarioCurrentUserFromPresence(data.presence));
            } catch (err) {
                if (isAuthenticationRequiredError(err)) return;
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
        if (readPendingAuthenticationRequired()) return undefined;
        const sseEnabled = window.SCENARIO_DRAFT_SSE_ENABLED === true;
        if (!sseEnabled || typeof window.EventSource !== 'function') return undefined;
        const source = new window.EventSource(buildScenarioDraftEventsStreamUrl(BACKEND_URL, scenarioActiveDraftId, scenarioDraftLastEventNumber));
        const expectedDraftId = scenarioActiveDraftId;
        const handleStreamMessage = (message) => {
            if (readPendingAuthenticationRequired()) return;
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
            if (readPendingAuthenticationRequired()) return;
            setScenarioDraftRealtimeStatus(prev => (
                prev.paused ? prev : { mode: 'polling', paused: false, message: 'Realtime stream disconnected; polling will continue.' }
            ));
            try {
                source.close();
            } catch (err) {
                // ignore close errors
            }
        };
        const closeForAuth = () => {
            try { source.close(); } catch (err) { /* ignore close errors */ }
        };
        window.addEventListener(AUTH_REQUIRED_EVENT, closeForAuth, { once: true });
        return () => {
            window.removeEventListener(AUTH_REQUIRED_EVENT, closeForAuth);
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
            if (readPendingAuthenticationRequired()) return;
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
        trackScenarioAction('draft_save', { dirty_state: scenarioHasUnsavedChanges ? 'dirty' : 'clean', override_count_bucket: bucketCount(Object.keys(normalizeScenarioDraftOverrides(scenarioOverrides)).length) });
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
            trackScenarioAction('draft_save_result', { result: 'success' });
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
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
            trackScenarioAction('draft_save_result', { result: 'failure', conflict_state: conflict ? 'conflict_remote' : 'none' });
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
        trackScenarioAction('history_open');
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
            if (isAuthenticationRequiredError(err)) return;
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
            if (isAuthenticationRequiredError(err)) return;
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
            if (readPendingAuthenticationRequired()) return;
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
            if (isAuthenticationRequiredError(err)) return;
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
        trackScenarioAction('writeback_preview');
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
            trackScenarioAction('writeback_preview_result', { result: 'success', selected_count_bucket: bucketCount(Array.isArray(preview?.changes) ? preview.changes.length : 0) });
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                return;
            }
            setScenarioDraftMeta(prev => ({
                ...prev,
                writebackPreviewing: false,
                error: err.message || 'Failed to preview Jira write-back.'
            }));
            trackScenarioAction('writeback_preview_result', { result: 'failure' });
        }
    };

    const checkScenarioDraftWritebackGate = async () => {
        const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
        if (!draftId) return;
        trackScenarioAction('writeback_gate');
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
            trackScenarioAction('writeback_gate_result', { result: 'success' });
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
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
            trackScenarioAction('writeback_gate_result', { result: blocked ? 'blocked' : 'failure', blocking_reason: blocked ? 'migration_gate' : 'unknown' });
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
            if (isAuthenticationRequiredError(err)) return;
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
    const scenarioLanes = React.useMemo(() => {
        const lanes = Array.from(scenarioLaneInfo.keys());
        return lanes.sort((a, b) => a.localeCompare(b));
    }, [scenarioLaneInfo]);
    const scenarioIssuesByLane = React.useMemo(() => {
        return buildLaneIssues(scenarioTimelineWithSegments, scenarioLaneMode, scenarioLaneForIssue);
    }, [scenarioTimelineWithSegments, scenarioLaneMode, scenarioEpicFocus]);
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
            if (readPendingAuthenticationRequired()) return;
            if (event.key === 'Escape') {
                clearScenarioEpicFocus();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('keydown', handleKey);
        };
    }, [scenarioEpicFocus]);
    return {
        registerScenarioIssueRef,
        runScenario,
        toggleScenarioEditMode,
        handleScenarioBarMouseDown,
        scenarioBaseUrl,
        scenarioHasUnsavedChanges,
        scenarioCanSaveDraft,
        scenarioRemoteEditors,
        scenarioIssueLockWarnings,
        scenarioSearchQuery,
        scenarioSearchMatchSet,
        scenarioIssueByKey,
        scenarioViewStart,
        scenarioViewEnd,
        scenarioFocusIssueKeys,
        scenarioFocusContextKeys,
        scenarioAssigneeConflicts,
        scenarioDepViolations,
        scenarioDepViolatedKeys,
        scenarioUndo,
        scenarioRedo,
        scenarioOverrideCount,
        saveScenarioDraft,
        discardScenarioOverrides,
        openScenarioDraftHistory,
        closeScenarioDraftHistory,
        requestReloadActiveDraft,
        cancelReloadActiveDraft,
        runReloadActiveDraft,
        requestScenarioHistoryAction,
        cancelScenarioHistoryAction,
        requestScenarioReloadFromJira,
        cancelScenarioReloadFromJira,
        runScenarioReloadFromJira,
        previewScenarioDraftWriteback,
        checkScenarioDraftWritebackGate,
        runScenarioHistoryAction,
        scenarioLaneInfo,
        scenarioLateItems,
        scenarioDeadlineAtRisk,
        scenarioCriticalPathItems,
        scenarioUnschedulableItems,
        scenarioIssuesByLane,
        scenarioTicks,
        scenarioQuarterMarkers,
        SCENARIO_LANE_HEIGHT,
        scenarioBarGap,
        scenarioJiraEpicKeys,
        scenarioJiraStoryKeys,
        scenarioLaneMeta,
        scenarioLaneAssigneeGroups,
        scenarioPositions,
        scenarioEpicBars,
        scenarioEpicEdges,
        scenarioTodayLeft,
        scenarioVisibleLanes,
        scenarioUpstreamSet,
        scenarioDownstreamSet,
        scenarioBlockedSet,
        toggleScenarioLane,
        showScenarioTooltip,
        showScenarioTooltipFromElement,
        moveScenarioTooltip,
        hideScenarioTooltip,
        clearScenarioEpicFocus,
        focusScenarioEpic,
        scrollToScenarioIssue,
    };
}
