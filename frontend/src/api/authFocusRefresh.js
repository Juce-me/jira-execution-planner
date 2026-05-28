let lastAuthRefreshAt = 0;

export async function refreshAuthOnFocus() {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastAuthRefreshAt < 60000) return;
    lastAuthRefreshAt = now;
    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'jira-execution-planner' },
        });
        if (response.status === 401) {
            const body = await response.json().catch(() => ({}));
            window.location.assign(body.loginUrl || '/login?reason=session_expired');
        }
    } catch (error) {
        // Leave network failures to the next focused attempt or API request.
    }
}

export function installAuthFocusRefresh() {
    window.addEventListener('focus', refreshAuthOnFocus);
    document.addEventListener('visibilitychange', refreshAuthOnFocus);
    refreshAuthOnFocus();
}

installAuthFocusRefresh();
