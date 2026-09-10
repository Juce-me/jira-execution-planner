const UI_PREFS_KEY = 'jira_dashboard_ui_prefs_v1';

export function isActiveHomeTokenConnection(connection) {
    return Boolean(connection?.connected && connection.status === 'active' && !connection.needsReconnect);
}

export function isBackendConnectionFailure(error) {
    if (!error || error.name === 'AbortError') return false;
    const message = String(error.message || error || '').toLowerCase();
    return message.includes('failed to fetch') ||
        message.includes('load failed') ||
        message.includes('networkerror') ||
        message.includes('network error') ||
        message.includes('connection refused');
}

export function getServerConnectionErrorMessage(backendUrl) {
    return `Server is not responding at ${backendUrl}. Start the Python server, then retry.`;
}

export function getCurrentQuarter() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    return `${year}Q${quarter}`;
}

export function setCookie(name, value, days = 365) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${JSON.stringify(value)};expires=${expires.toUTCString()};path=/`;
}

export function getCookie(name) {
    const namePrefix = `${name}=`;
    const cookies = document.cookie.split(';');
    for (let index = 0; index < cookies.length; index += 1) {
        let cookie = cookies[index];
        while (cookie.charAt(0) === ' ') cookie = cookie.substring(1, cookie.length);
        if (cookie.indexOf(namePrefix) !== 0) continue;
        try {
            return JSON.parse(cookie.substring(namePrefix.length, cookie.length));
        } catch (_error) {
            return null;
        }
    }
    return null;
}

export function loadUiPrefs() {
    try {
        const raw = window.localStorage.getItem(UI_PREFS_KEY);
        if (!raw) return null;
        const prefs = JSON.parse(raw);
        if (prefs && typeof prefs === 'object') prefs.showScenario = false;
        return prefs;
    } catch (_error) {
        return null;
    }
}

export function saveUiPrefs(prefs) {
    try {
        window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
    } catch (_error) {
        // Ignore unavailable browser storage.
    }
}
