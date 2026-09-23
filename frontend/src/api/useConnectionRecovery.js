import * as React from 'react';
import { fetchAppConfig } from './configApi.js';
import { CONNECTION_AVAILABLE_EVENT, CONNECTION_UNAVAILABLE_EVENT } from './authRefreshContract.js';
import { isAuthenticationRequiredError, readPendingAuthenticationRequired } from './authRequired.js';
import {
    canAutomaticallyRecoverConnection,
    clearConnectionRecoveryAttempt,
    clearConnectionRecoveryState,
    getConnectionRecoveryStorage,
    markConnectionRecoveryAttempt,
    readConnectionRecoveryAttempt,
    readConnectionRecoveryState,
    writeConnectionRecoveryState,
} from './connectionRecoveryState.js';
import { getServerConnectionErrorMessage, isBackendConnectionFailure } from '../dashboardRuntime.js';

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

    const reportServerConnectionError = React.useCallback((err) => {
        if (!isBackendConnectionFailure(err)) return false;
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
    }, [backendUrl, setServerConnectionError]);

    const consume = React.useCallback((principal) => {
        const recovery = readConnectionRecoveryState(getConnectionRecoveryStorage(window), principal);
        pendingRef.current = recovery;
        if (recovery?.droppedSettings) setNotice(settingsDiscardedNotice);
        if (recovery) setStagedRevision(revision => revision + 1);
        return recovery;
    }, []);

    const recover = React.useCallback(async ({ manual = false, discardSettings = false } = {}) => {
        if (!unavailableRef.current || inFlightRef.current || reloadStartedRef.current) return;
        const storage = getConnectionRecoveryStorage(window);
        const outageId = outageIdRef.current;
        if (!manual && !canAutomaticallyRecoverConnection(storage, outageId)) {
            setStatus('manual_required');
            return;
        }
        inFlightRef.current = true;
        setStatus('checking');
        try {
            const mountedPrincipal = principalRef.current;
            if (!mountedPrincipal?.workspaceId || !mountedPrincipal?.viewConfigId) {
                throw new Error('Connection recovery is waiting for the current workspace identity.');
            }
            const config = await fetchAppConfig(backendUrl, { cache: 'no-cache' });
            if (readPendingAuthenticationRequired()) return;
            const freshPrincipal = {
                workspaceId: String(config.viewConfig?.workspaceId || ''),
                viewConfigId: String(config.viewConfig?.viewConfigId || ''),
            };
            if (freshPrincipal.workspaceId !== mountedPrincipal.workspaceId
                || freshPrincipal.viewConfigId !== mountedPrincipal.viewConfigId) {
                setStatus('unavailable');
                setNotice({
                    kind: 'identity_changed',
                    message: 'The active workspace or private view changed. Reload the page normally before continuing.',
                });
                return;
            }
            const captured = snapshotRef.current?.();
            const snapshot = captured ? { ...captured, outage: { id: outageId } } : captured;
            const capsuleWritten = writeConnectionRecoveryState(storage, snapshot);
            if (!capsuleWritten && snapshot?.scenario) {
                setStatus('unavailable');
                setNotice({
                    kind: 'preservation_failed',
                    message: 'The page cannot reload safely because your unsaved Scenario changes could not be preserved in this tab.',
                });
                return;
            }
            if (!capsuleWritten && snapshot?.droppedSettings && !discardSettings) {
                setStatus('settings_discard_required');
                setNotice({
                    kind: 'settings_discard_required',
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
            if (!reportServerConnectionError(err)) {
                setNotice({ kind: 'probe_failed', message: err.message || 'The server is still unavailable.' });
            }
        } finally {
            inFlightRef.current = false;
        }
    }, [backendUrl, principalRef, reportServerConnectionError, snapshotRef]);

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
        clearServerConnectionError,
        consume,
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
