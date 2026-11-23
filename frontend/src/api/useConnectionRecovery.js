import * as React from 'react';
import { fetchAppConfig } from './configApi.js';
import { CONNECTION_AVAILABLE_EVENT, CONNECTION_UNAVAILABLE_EVENT, PERIMETER_SESSION_EXPIRED_EVENT } from './authRefreshContract.js';
import { isAuthenticationRequiredError, readPendingAuthenticationRequired } from './authRequired.js';
import { hasPendingMutations, isPerimeterSessionExpiredError, PerimeterSessionExpiredError, waitForPendingMutations } from './http.js';
import {
    canAutomaticallyRecoverConnection,
    clearConnectionRecoveryAttempt,
    clearConnectionRecoveryState,
    connectionRecoveryPrincipalFromConfig,
    getConnectionRecoveryStorage,
    markConnectionRecoveryAttempt,
    readConnectionRecoveryAttempt,
    readConnectionRecoveryState,
    sameConnectionRecoveryPrincipal,
    writeConnectionRecoveryState,
} from './connectionRecoveryState.js';
import { getServerConnectionErrorMessage, isBackendConnectionFailure } from '../dashboardRuntime.js';

export const CONNECTION_PROBE_TIMEOUT_MS = 10_000;

// Statuses during which the server is unreachable or recovery owns the page; Refresh Jira waits.
const REFRESH_BLOCKING_STATUSES = new Set([
    'unavailable', 'manual_required', 'discard_required', 'checking', 'waiting_for_save', 'restoring',
]);

const settingsDiscardedNotice = {
    kind: 'settings_discarded',
    message: 'Unsaved configuration changes were discarded while restoring the connection.',
};

export function useConnectionRecovery({
    backendUrl,
    principalRef,
    snapshotRef,
    setServerConnectionError,
}) {
    const [status, setStatus] = React.useState('idle');
    const statusRef = React.useRef(status);
    const [perimeterExpired, setPerimeterExpired] = React.useState(false);
    const perimeterEncounteredRef = React.useRef(false);
    const [notice, setNotice] = React.useState(null);
    const [stagedRevision, setStagedRevision] = React.useState(0);
    const inFlightRef = React.useRef(false);
    const reloadStartedRef = React.useRef(false);
    const unavailableRef = React.useRef(false);
    const preservationFailedRef = React.useRef(false);
    const bootstrapHealthRef = React.useRef(new Set());
    const initialAttemptRef = React.useRef(undefined);
    if (initialAttemptRef.current === undefined) {
        initialAttemptRef.current = readConnectionRecoveryAttempt(getConnectionRecoveryStorage(window));
    }
    const outageIdRef = React.useRef(initialAttemptRef.current?.outageId || '');
    const pendingRef = React.useRef(null);

    const setStatusTracked = React.useCallback((next) => {
        statusRef.current = next;
        setStatus(next);
    }, []);

    const scenarioStartedRef = React.useMemo(() => {
        let started = false;
        return {
            get current() { return started; },
            set current(next) {
                if (started === next) return;
                started = next;
                // Scenario can finish while Planning still owns the capsule and no release runs.
                if (!started && unavailableRef.current && statusRef.current === 'restoring' && !reloadStartedRef.current) {
                    setStatusTracked('unavailable');
                }
            },
        };
    }, [setStatusTracked]);

    const releaseOwnership = React.useCallback((nextStatus = 'idle') => {
        unavailableRef.current = false;
        preservationFailedRef.current = false;
        perimeterEncounteredRef.current = false;
        setPerimeterExpired(false);
        setStatusTracked(nextStatus);
        window.dispatchEvent(new Event(CONNECTION_AVAILABLE_EVENT));
    }, [setStatusTracked]);

    // Restoring the reload capsule ends only the previous outage; an outage reported after the reload
    // is still active and must keep ownership so focus/visibility recovery can reload again.
    const releaseRestoredOwnership = React.useCallback((nextStatus = 'idle') => {
        if (unavailableRef.current) {
            if (statusRef.current === 'restoring' && !reloadStartedRef.current) setStatusTracked('unavailable');
            return;
        }
        releaseOwnership(nextStatus);
    }, [releaseOwnership, setStatusTracked]);

    const clearServerConnectionError = React.useCallback(() => {
        if (!unavailableRef.current) setServerConnectionError('');
    }, [setServerConnectionError]);

    const markBootstrapHealthy = React.useCallback((part) => {
        bootstrapHealthRef.current.add(part);
        if (!['config', 'groups', 'sprints'].every(required => bootstrapHealthRef.current.has(required))) return;
        outageIdRef.current = '';
        preservationFailedRef.current = false;
        perimeterEncounteredRef.current = false;
        clearConnectionRecoveryAttempt(getConnectionRecoveryStorage(window));
        setPerimeterExpired(false);
        setServerConnectionError('');
        if (!pendingRef.current) releaseOwnership('idle');
    }, [releaseOwnership, setServerConnectionError]);

    // A bootstrap read that received any HTTP response proves the server is reachable, so it counts
    // toward ending the outage even when that read failed for another reason.
    const reportServerConnectionError = React.useCallback((err, { bootstrapPart = '' } = {}) => {
        if (!isBackendConnectionFailure(err)) {
            if (bootstrapPart && !isAuthenticationRequiredError(err) && err?.name !== 'AbortError') {
                markBootstrapHealthy(bootstrapPart);
            }
            return false;
        }
        if (!unavailableRef.current) {
            bootstrapHealthRef.current.clear();
            outageIdRef.current = outageIdRef.current
                || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        }
        unavailableRef.current = true;
        const expired = isPerimeterSessionExpiredError(err);
        if (expired) perimeterEncounteredRef.current = true;
        setPerimeterExpired(expired);
        setServerConnectionError(expired
            ? 'Your sign-in session expired. Reloading to sign in again; unsaved changes are kept.'
            : getServerConnectionErrorMessage(backendUrl));
        if (!['checking', 'waiting_for_save', 'restoring', 'manual_required', 'reload_offered'].includes(statusRef.current)) {
            setStatusTracked('unavailable');
        }
        window.dispatchEvent(new Event(CONNECTION_UNAVAILABLE_EVENT));
        return true;
    }, [backendUrl, markBootstrapHealthy, setServerConnectionError, setStatusTracked]);

    const consume = React.useCallback((principal) => {
        const recovery = readConnectionRecoveryState(getConnectionRecoveryStorage(window), principal);
        const pending = pendingRef.current;
        // A background config refresh must not reinstall an already restored owner,
        // or erase a validated mounted draft when its tab storage becomes unavailable.
        if (pending && sameConnectionRecoveryPrincipal(pending.principal, principal)
            && (!recovery || pending.capturedAt === recovery.capturedAt && pending.outage.id === recovery.outage.id)) return pending;
        pendingRef.current = recovery;
        if (recovery?.droppedSettings) setNotice(settingsDiscardedNotice);
        if (recovery) setStagedRevision(revision => revision + 1);
        return recovery;
    }, []);

    const recover = React.useCallback(async ({ manual = false, discardUnsaved = false } = {}) => {
        if (!unavailableRef.current || inFlightRef.current || reloadStartedRef.current || scenarioStartedRef.current) return;
        const storage = getConnectionRecoveryStorage(window);
        const outageId = outageIdRef.current;
        if (!manual && !canAutomaticallyRecoverConnection(storage, outageId)) {
            setStatusTracked('manual_required');
            return;
        }
        inFlightRef.current = true;
        setStatusTracked('checking');
        const probe = new AbortController();
        const probeTimer = window.setTimeout(() => probe.abort(), CONNECTION_PROBE_TIMEOUT_MS);
        try {
            let config;
            let perimeterReachable = false;
            try {
                config = await fetchAppConfig(backendUrl, { cache: 'no-cache', signal: probe.signal });
            } catch (error) {
                if (!isPerimeterSessionExpiredError(error)) throw error;
                perimeterReachable = true;
                perimeterEncounteredRef.current = true;
                config = null;
            } finally {
                window.clearTimeout(probeTimer);
            }
            if (readPendingAuthenticationRequired() || scenarioStartedRef.current) return;
            const mountedPrincipal = principalRef.current;
            const identityChanged = !perimeterReachable && Boolean(mountedPrincipal)
                && !sameConnectionRecoveryPrincipal(mountedPrincipal, connectionRecoveryPrincipalFromConfig(config));
            // A write sent during the outage may still land; reloading first would report the user's own
            // save as a remote conflict. Capture the page only after it settles. The wait is bounded so a
            // hung request cannot block recovery.
            if (hasPendingMutations()) {
                setStatusTracked('waiting_for_save');
                setNotice({ kind: 'waiting_for_save', message: 'Waiting for a pending save to finish before reloading.' });
                await waitForPendingMutations(CONNECTION_PROBE_TIMEOUT_MS);
                setNotice(null);
                if (readPendingAuthenticationRequired() || scenarioStartedRef.current) return;
            }
            let captured;
            try { captured = mountedPrincipal ? snapshotRef.current?.() : null; }
            catch (error) {
                if (!discardUnsaved) {
                    preservationFailedRef.current = true;
                    setStatusTracked('unavailable');
                    setNotice({ kind: 'preservation_failed', message: 'Your unsaved changes could not be preserved in this tab. Stay here or explicitly reload without preserving changes.' });
                    return;
                }
                captured = null;
            }
            if (identityChanged && (captured?.scenario || captured?.planning) && !discardUnsaved) {
                setStatusTracked('discard_required');
                setNotice({
                    kind: 'discard_required',
                    message: `The active workspace or private view changed. Reloading will discard your unsaved ${[captured.planning && 'Planning', captured.scenario && 'Scenario'].filter(Boolean).join(' and ')} changes.`,
                });
                return;
            }
            const snapshot = captured && !identityChanged ? { ...captured, outage: { id: outageId } } : null;
            const capsuleWritten = snapshot ? writeConnectionRecoveryState(storage, snapshot) : false;
            // A recovery probe does not mount the principal, even if sign-in already succeeded
            // elsewhere. Leave the previous capsule for validation at bootstrap.
            const retainStoredCapsule = perimeterEncounteredRef.current && !mountedPrincipal && !discardUnsaved;
            if (!capsuleWritten && !retainStoredCapsule) clearConnectionRecoveryState(storage);
            if (!capsuleWritten && (snapshot?.scenario || snapshot?.planning) && !discardUnsaved) {
                preservationFailedRef.current = true;
                setStatusTracked('unavailable');
                setNotice({
                    kind: 'preservation_failed',
                    message: `The page cannot reload safely because your unsaved ${[snapshot.planning && 'Planning', snapshot.scenario && 'Scenario'].filter(Boolean).join(' and ')} changes could not be preserved in this tab.`,
                });
                return;
            }
            if (!capsuleWritten && snapshot?.droppedSettings && !discardUnsaved) {
                setStatusTracked('discard_required');
                setNotice({
                    kind: 'discard_required',
                    message: 'Unsaved configuration cannot be preserved in this tab. Reloading will discard it.',
                });
                return;
            }
            const attemptMarked = markConnectionRecoveryAttempt(storage, outageId);
            if (!attemptMarked && !manual) {
                if (capsuleWritten) clearConnectionRecoveryState(storage);
                setStatusTracked('manual_required');
                setNotice({
                    kind: 'manual_required',
                    message: 'Automatic recovery could not create a reload-loop guard. Use the button to reload explicitly.',
                });
                return;
            }
            if (readPendingAuthenticationRequired()) {
                if (!retainStoredCapsule) clearConnectionRecoveryState(storage);
                clearConnectionRecoveryAttempt(storage);
                return;
            }
            setStatusTracked('restoring');
            reloadStartedRef.current = true;
            window.location.reload();
        } catch (err) {
            if (isAuthenticationRequiredError(err) || readPendingAuthenticationRequired()) return;
            setStatusTracked('unavailable');
            if (probe.signal.aborted) {
                setNotice({ kind: 'probe_failed', message: 'The server did not answer within 10 seconds. Retry when it is available.' });
            } else if (reportServerConnectionError(err)) {
                setNotice({ kind: 'probe_failed', message: 'The server is still unreachable. Retry when it is available.' });
            } else {
                setNotice({ kind: 'probe_failed', message: err.message || 'The server is still unavailable.' });
            }
        } finally {
            inFlightRef.current = false;
        }
    }, [backendUrl, principalRef, reportServerConnectionError, scenarioStartedRef, setStatusTracked, snapshotRef]);

    const discardRecovery = React.useCallback(() => {
        clearConnectionRecoveryState(getConnectionRecoveryStorage(window));
        pendingRef.current = null;
        setNotice(null);
        setStatusTracked(unavailableRef.current ? 'unavailable' : 'idle');
    }, [setStatusTracked]);

    const recoverRef = React.useRef(recover);
    recoverRef.current = recover;
    React.useEffect(() => {
        const handleVisibleReturn = () => {
            if (document.visibilityState !== 'visible' || !unavailableRef.current || statusRef.current === 'restoring' || scenarioStartedRef.current) return;
            void recoverRef.current({ manual: false });
        };
        const canStartPerimeterRecovery = () => document.visibilityState === 'visible'
            && unavailableRef.current && !inFlightRef.current && !reloadStartedRef.current && !scenarioStartedRef.current
            // A failed capsule write leaves the page mounted without a durable attempt marker.
            && !preservationFailedRef.current && ['idle', 'unavailable'].includes(statusRef.current);
        const handlePerimeterExpiry = () => {
            reportServerConnectionError(new PerimeterSessionExpiredError());
            if (!canStartPerimeterRecovery()) return;
            queueMicrotask(() => {
                if (canStartPerimeterRecovery()) void recoverRef.current({ manual: false });
            });
        };
        document.addEventListener('visibilitychange', handleVisibleReturn);
        window.addEventListener('focus', handleVisibleReturn);
        window.addEventListener(PERIMETER_SESSION_EXPIRED_EVENT, handlePerimeterExpiry);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibleReturn);
            window.removeEventListener('focus', handleVisibleReturn);
            window.removeEventListener(PERIMETER_SESSION_EXPIRED_EVENT, handlePerimeterExpiry);
        };
    }, [reportServerConnectionError, scenarioStartedRef]);

    return {
        blocksManualRefresh: REFRESH_BLOCKING_STATUSES.has(status),
        clearServerConnectionError,
        consume,
        discardRecovery,
        markBootstrapHealthy,
        notice,
        pendingRef,
        perimeterExpired,
        recover,
        releaseOwnership: releaseRestoredOwnership,
        reportServerConnectionError,
        scenarioStartedRef,
        setNotice,
        setStagedRevision,
        setStatus: setStatusTracked,
        stagedRevision,
        status,
        unavailableRef,
    };
}

export function settingsDiscardedRecoveryNotice() {
    return settingsDiscardedNotice;
}

export function buildConnectionRecoveryShellState(recovery) {
    return {
        selectedView: recovery.view.selectedView,
        activeGroupId: recovery.view.activeGroupId || '',
        selectedSprint: recovery.view.selectedSprint || '',
        engMode: recovery.view.engMode || 'catch-up',
        settingsOpen: false,
        settingsTab: 'teams',
    };
}

export function buildConnectionRecoverySnapshot({
    activeGroupId,
    dirtySettings,
    principal,
    scenario,
    planning,
    selectedSprint,
    selectedView,
    viewMode,
}) {
    return {
        principal,
        outage: { id: '' },
        view: {
            selectedView,
            activeGroupId: activeGroupId ? String(activeGroupId) : null,
            selectedSprint: selectedSprint === null ? null : String(selectedSprint),
            engMode: viewMode,
            scrollX: Math.max(0, window.scrollX || 0),
            scrollY: Math.max(0, window.scrollY || 0),
        },
        droppedSettings: Boolean(dirtySettings),
        scenario,
        ...(planning === undefined ? {} : { planning }),
    };
}
