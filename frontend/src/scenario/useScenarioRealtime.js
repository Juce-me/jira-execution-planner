import * as React from 'react';
import { AUTH_REQUIRED_EVENT, isAuthenticationRequiredError, readPendingAuthenticationRequired } from '../api/authRequired.js';
import { buildScenarioDraftEventsStreamUrl } from '../api/scenarioApi.js';

export function useScenarioRealtime({
    scenarioState,
    BACKEND_URL,
    pauseScenarioRealtime,
    postScenarioRealtimeJson,
    pollScenarioDraftEvents,
    scenarioScopeKey,
    scenarioActiveDraftId,
    scenarioActiveDraftReady,
}) {
    const {
        scenarioCurrentUserIdentity,
        setScenarioCurrentUserIdentity,
        scenarioActiveDraftIdRef,
        scenarioScopeKeyRef,
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
        scenarioHistoryRefreshControllerRef,
        scenarioHistoryActionControllerRef,
    } = scenarioState;
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
    return {
        acquireScenarioIssueLock,
        refreshScenarioIssueLock,
        releaseScenarioIssueLock,
        scenarioRemoteEditors,
        scenarioIssueLockWarnings,
    };
}
