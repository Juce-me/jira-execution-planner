import * as React from 'react';
import { fetchAppConfig } from './configApi.js';
import { CONNECTION_AVAILABLE_EVENT, CONNECTION_UNAVAILABLE_EVENT } from './authRefreshContract.js';
import { isAuthenticationRequiredError, readPendingAuthenticationRequired } from './authRequired.js';
import { hasPendingMutations, waitForPendingMutations } from './http.js';
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
    const [notice, setNotice] = React.useState(null);
    const [stagedRevision, setStagedRevision] = React.useState(0);
    const inFlightRef = React.useRef(false);
    const reloadStartedRef = React.useRef(false);
    const unavailableRef = React.useRef(false);
    const bootstrapHealthRef = React.useRef(new Set());
    const initialAttemptRef = React.useRef(undefined);
    if (initialAttemptRef.current === undefined) {
        initialAttemptRef.current = readConnectionRecoveryAttempt(getConnectionRecoveryStorage(window));
    }
    const outageIdRef = React.useRef(initialAttemptRef.current?.outageId || '');
    const pendingRef = React.useRef(null);
    const scenarioStartedRef = React.useRef(false);

    const releaseOwnership = React.useCallback((nextStatus = 'idle') => {
        unavailableRef.current = false;
        setStatus(nextStatus);
        window.dispatchEvent(new Event(CONNECTION_AVAILABLE_EVENT));
    }, []);

    const clearServerConnectionError = React.useCallback(() => {
        if (!unavailableRef.current) setServerConnectionError('');
    }, [setServerConnectionError]);

    const markBootstrapHealthy = React.useCallback((part) => {
        bootstrapHealthRef.current.add(part);
        if (!['config', 'groups', 'sprints'].every(required => bootstrapHealthRef.current.has(required))) return;
        outageIdRef.current = '';
        clearConnectionRecoveryAttempt(getConnectionRecoveryStorage(window));
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
        setServerConnectionError(getServerConnectionErrorMessage(backendUrl));
        setStatus(current => current === 'checking' ? current : 'unavailable');
        window.dispatchEvent(new Event(CONNECTION_UNAVAILABLE_EVENT));
        return true;
    }, [backendUrl, markBootstrapHealthy, setServerConnectionError]);

    const consume = React.useCallback((principal) => {
        const recovery = readConnectionRecoveryState(getConnectionRecoveryStorage(window), principal);
        pendingRef.current = recovery;
        if (recovery?.droppedSettings) setNotice(settingsDiscardedNotice);
        if (recovery) setStagedRevision(revision => revision + 1);
        return recovery;
    }, []);

    const recover = React.useCallback(async ({ manual = false, discardUnsaved = false } = {}) => {
        if (!unavailableRef.current || inFlightRef.current || reloadStartedRef.current) return;
        const storage = getConnectionRecoveryStorage(window);
        const outageId = outageIdRef.current;
        if (!manual && !canAutomaticallyRecoverConnection(storage, outageId)) {
            setStatus('manual_required');
            return;
        }
        inFlightRef.current = true;
        setStatus('checking');
        const probe = new AbortController();
        const probeTimer = window.setTimeout(() => probe.abort(), CONNECTION_PROBE_TIMEOUT_MS);
        try {
            let config;
            try {
                config = await fetchAppConfig(backendUrl, { cache: 'no-cache', signal: probe.signal });
            } finally {
                window.clearTimeout(probeTimer);
            }
            if (readPendingAuthenticationRequired()) return;
            // Without a mounted identity (the page never bootstrapped, or DB mode has no view config)
            // nothing can be matched safely, so the reload starts clean.
            const mountedPrincipal = principalRef.current;
            const identityChanged = Boolean(mountedPrincipal)
                && !sameConnectionRecoveryPrincipal(mountedPrincipal, connectionRecoveryPrincipalFromConfig(config));
            // A write sent during the outage may still land; reloading first would report the user's own
            // save as a remote conflict. Capture the page only after it settles. The wait is bounded so a
            // hung request cannot block recovery.
            if (hasPendingMutations()) {
                setStatus('waiting_for_save');
                setNotice({ kind: 'waiting_for_save', message: 'Waiting for a pending save to finish before reloading.' });
                await waitForPendingMutations(CONNECTION_PROBE_TIMEOUT_MS);
                setNotice(null);
                if (readPendingAuthenticationRequired()) return;
            }
            const captured = mountedPrincipal ? snapshotRef.current?.() : null;
            if (identityChanged && captured?.scenario && !discardUnsaved) {
                setStatus('discard_required');
                setNotice({
                    kind: 'discard_required',
                    message: 'The active workspace or private view changed. Reloading will discard your unsaved Scenario changes.',
                });
                return;
            }
            const snapshot = captured && !identityChanged ? { ...captured, outage: { id: outageId } } : null;
            const capsuleWritten = snapshot ? writeConnectionRecoveryState(storage, snapshot) : false;
            if (!capsuleWritten) clearConnectionRecoveryState(storage);
            if (!capsuleWritten && snapshot?.scenario) {
                setStatus('unavailable');
                setNotice({
                    kind: 'preservation_failed',
                    message: 'The page cannot reload safely because your unsaved Scenario changes could not be preserved in this tab.',
                });
                return;
            }
            if (!capsuleWritten && snapshot?.droppedSettings && !discardUnsaved) {
                setStatus('discard_required');
                setNotice({
                    kind: 'discard_required',
                    message: 'Unsaved configuration cannot be preserved in this tab. Reloading will discard it.',
                });
                return;
            }
            const attemptMarked = markConnectionRecoveryAttempt(storage, outageId);
            if (!attemptMarked && !manual) {
                if (capsuleWritten) clearConnectionRecoveryState(storage);
                setStatus('manual_required');
                setNotice({
                    kind: 'manual_required',
                    message: 'Automatic recovery could not create a reload-loop guard. Use Retry connection to reload explicitly.',
                });
                return;
            }
            if (readPendingAuthenticationRequired()) {
                clearConnectionRecoveryState(storage);
                clearConnectionRecoveryAttempt(storage);
                return;
            }
            setStatus('restoring');
            reloadStartedRef.current = true;
            window.location.reload();
        } catch (err) {
            if (isAuthenticationRequiredError(err) || readPendingAuthenticationRequired()) return;
            setStatus('unavailable');
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
    }, [backendUrl, principalRef, reportServerConnectionError, snapshotRef]);

    const discardRecovery = React.useCallback(() => {
        clearConnectionRecoveryState(getConnectionRecoveryStorage(window));
        pendingRef.current = null;
        setNotice(null);
        setStatus(unavailableRef.current ? 'unavailable' : 'idle');
    }, []);

    const recoverRef = React.useRef(recover);
    recoverRef.current = recover;
    React.useEffect(() => {
        const handleVisibleReturn = () => {
            if (document.visibilityState !== 'visible' || !unavailableRef.current) return;
            void recoverRef.current({ manual: false });
        };
        document.addEventListener('visibilitychange', handleVisibleReturn);
        window.addEventListener('focus', handleVisibleReturn);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibleReturn);
            window.removeEventListener('focus', handleVisibleReturn);
        };
    }, []);

    return {
        blocksManualRefresh: REFRESH_BLOCKING_STATUSES.has(status),
        clearServerConnectionError,
        consume,
        discardRecovery,
        markBootstrapHealthy,
        notice,
        pendingRef,
        recover,
        releaseOwnership,
        reportServerConnectionError,
        scenarioStartedRef,
        setNotice,
        setStagedRevision,
        setStatus,
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
    };
}
