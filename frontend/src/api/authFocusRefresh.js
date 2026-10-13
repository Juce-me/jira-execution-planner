import {
    AUTH_REFRESH_THROTTLE_MS,
    LONG_ABSENCE_MS,
    AUTH_REFRESH_SHARED_STORAGE_KEY,
    AUTH_LONG_ABSENCE_EVENT,
    AUTH_LONG_ABSENCE_SLOT,
    AUTH_SESSION_REFRESH_EVENT,
    AUTH_FOCUS_REFRESH_STATE_EVENT,
    CONNECTION_UNAVAILABLE_EVENT,
    CONNECTION_AVAILABLE_EVENT,
} from './authRefreshContract.js';
import { apiFetch } from './http.js';
import { AUTH_REQUIRED_EVENT, isAuthenticationRequiredError, readPendingAuthenticationRequired } from './authRequired.js';
import { getConnectionRecoveryStorage, readConnectionRecoveryAttempt } from './connectionRecoveryState.js';

let lastAuthRefreshAt = 0;
let unfocusedSince = null;
let pendingLongReturn = null;
let lastAttemptSucceeded = false;
let refreshInFlight = false;
let listenersInstalled = false;
let connectionUnavailable = Boolean(readConnectionRecoveryAttempt(getConnectionRecoveryStorage(window)));

function readSharedRefreshAt() {
    try {
        return Number(localStorage.getItem(AUTH_REFRESH_SHARED_STORAGE_KEY)) || 0;
    } catch (error) {
        return 0;
    }
}

function writeSharedRefreshAt(timestamp) {
    try {
        localStorage.setItem(AUTH_REFRESH_SHARED_STORAGE_KEY, String(timestamp));
    } catch (error) {
        // Ignore storage failures; per-tab throttling still applies.
    }
}

function clearSharedRefreshAt() {
    try {
        localStorage.removeItem(AUTH_REFRESH_SHARED_STORAGE_KEY);
    } catch (error) {
        // Ignore storage failures.
    }
}

function isFocused() {
    return (!document.visibilityState || document.visibilityState === 'visible')
        && (!document.hasFocus || document.hasFocus());
}

function dispatchActivity(status) {
    window.dispatchEvent(new CustomEvent(AUTH_FOCUS_REFRESH_STATE_EVENT, { detail: { status } }));
}

function dispatchPendingLongReturn() {
    if (pendingLongReturn === null || !isFocused() || connectionUnavailable || readPendingAuthenticationRequired()) return;
    const absenceStartedAtMs = pendingLongReturn;
    const observedAtMs = Date.now();
    pendingLongReturn = null;
    const earliest = Math.min(absenceStartedAtMs, window[AUTH_LONG_ABSENCE_SLOT]?.absenceStartedAtMs ?? absenceStartedAtMs);
    const detail = { unfocusedMs: observedAtMs - earliest, absenceStartedAtMs: earliest, observedAtMs };
    // Only timestamps are retained until a mounted subscriber owns the intent.
    window[AUTH_LONG_ABSENCE_SLOT] = detail;
    window.dispatchEvent(new CustomEvent(AUTH_LONG_ABSENCE_EVENT, {
        detail,
    }));
}

function dispatchAuthSessionRefreshEvent() {
    window.dispatchEvent(new CustomEvent(AUTH_SESSION_REFRESH_EVENT));
}

export async function refreshAuthOnFocus({ longAbsence = false, unfocusedMs = 0 } = {}) {
    if (readPendingAuthenticationRequired()) { pendingLongReturn = null; delete window[AUTH_LONG_ABSENCE_SLOT]; return; }
    if (longAbsence && isFocused()) pendingLongReturn ??= Date.now() - unfocusedMs;
    if (connectionUnavailable) return;
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    if (refreshInFlight) return;
    const now = Date.now();
    const shared = readSharedRefreshAt();
    const last = Math.max(lastAuthRefreshAt, shared);
    if (last !== 0 && now - last < AUTH_REFRESH_THROTTLE_MS) {
        if (pendingLongReturn !== null && isFocused() && (shared > lastAuthRefreshAt || lastAttemptSucceeded)) {
            dispatchActivity('refreshing');
            dispatchPendingLongReturn();
            dispatchActivity('settled');
        }
        return;
    }
    lastAuthRefreshAt = now;
    lastAttemptSucceeded = false;
    writeSharedRefreshAt(now);
    refreshInFlight = true;
    dispatchActivity('refreshing');
    let status = 'failed';
    try {
        const response = await apiFetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'jira-execution-planner' },
        });
        if (response.ok && !readPendingAuthenticationRequired()) {
            lastAttemptSucceeded = true;
            status = 'settled';
            if (!connectionUnavailable) {
                // Permission-scoped caches still partition on the refreshed Jira principal.
                dispatchAuthSessionRefreshEvent();
                dispatchPendingLongReturn();
            }
        }
    } catch (error) {
        if (isAuthenticationRequiredError(error)) {
            pendingLongReturn = null;
            clearSharedRefreshAt();
        }
        // Leave network failures to the next focused attempt or API request.
    } finally {
        refreshInFlight = false;
        dispatchActivity(status);
    }
}

function noteDashboardUnfocused() {
    if (unfocusedSince === null) unfocusedSince = Date.now();
}

function handleVisibleReturn() {
    if (document.visibilityState && document.visibilityState !== 'visible') {
        noteDashboardUnfocused();
        return;
    }
    if (!isFocused()) { noteDashboardUnfocused(); refreshAuthOnFocus(); return; }
    const since = unfocusedSince;
    unfocusedSince = null;
    const unfocusedMs = since === null ? 0 : Date.now() - since;
    if (since !== null && unfocusedMs > LONG_ABSENCE_MS) pendingLongReturn ??= since;
    refreshAuthOnFocus({ longAbsence: pendingLongReturn !== null, unfocusedMs });
}

function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
        noteDashboardUnfocused();
    } else {
        handleVisibleReturn();
    }
}

export function installAuthFocusRefresh() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    window.addEventListener(AUTH_REQUIRED_EVENT, () => { pendingLongReturn = null; delete window[AUTH_LONG_ABSENCE_SLOT]; clearSharedRefreshAt(); });
    window.addEventListener('blur', noteDashboardUnfocused);
    window.addEventListener('focus', handleVisibleReturn);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(CONNECTION_UNAVAILABLE_EVENT, () => {
        connectionUnavailable = true;
    });
    window.addEventListener(CONNECTION_AVAILABLE_EVENT, () => {
        connectionUnavailable = false;
        if (pendingLongReturn !== null) void refreshAuthOnFocus();
    });
    handleVisibleReturn();
}

installAuthFocusRefresh();
