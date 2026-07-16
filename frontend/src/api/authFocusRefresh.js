import {
    AUTH_REFRESH_THROTTLE_MS,
    LONG_ABSENCE_MS,
    AUTH_REFRESH_SHARED_STORAGE_KEY,
    AUTH_LONG_ABSENCE_EVENT,
} from './authRefreshContract.js';

let lastAuthRefreshAt = 0;
let unfocusedSince = null;
let refreshInFlight = false;
let listenersInstalled = false;

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

function dispatchLongAbsenceEvent(unfocusedMs) {
    window.dispatchEvent(new CustomEvent(AUTH_LONG_ABSENCE_EVENT, { detail: { unfocusedMs } }));
}

export async function refreshAuthOnFocus({ longAbsence = false, unfocusedMs = 0 } = {}) {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    if (refreshInFlight) return;
    const now = Date.now();
    const last = Math.max(lastAuthRefreshAt, readSharedRefreshAt());
    if (last !== 0 && now - last < AUTH_REFRESH_THROTTLE_MS) {
        if (longAbsence) dispatchLongAbsenceEvent(unfocusedMs);
        return;
    }
    lastAuthRefreshAt = now;
    writeSharedRefreshAt(now);
    refreshInFlight = true;
    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'jira-execution-planner' },
        });
        if (response.status === 401) {
            clearSharedRefreshAt();
            const body = await response.json().catch(() => ({}));
            window.location.assign(body.loginUrl || '/login?reason=session_expired');
        } else if (response.ok && longAbsence) {
            dispatchLongAbsenceEvent(unfocusedMs);
        }
    } catch (error) {
        // Leave network failures to the next focused attempt or API request.
    } finally {
        refreshInFlight = false;
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
    const since = unfocusedSince;
    unfocusedSince = null;
    const unfocusedMs = since === null ? 0 : Date.now() - since;
    refreshAuthOnFocus({ longAbsence: unfocusedMs > LONG_ABSENCE_MS, unfocusedMs });
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
    window.addEventListener('blur', noteDashboardUnfocused);
    window.addEventListener('focus', handleVisibleReturn);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    handleVisibleReturn();
}

installAuthFocusRefresh();
