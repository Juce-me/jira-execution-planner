export const AUTH_REQUIRED_EVENT = 'jep:authentication-required';
export const AUTHENTICATION_REQUIRED_CODE = 'auth_required';

const AUTH_REQUIRED_SLOT = '__JEP_AUTH_REQUIRED__';
const FALLBACK_LOGIN_URL = '/login?reason=session_expired';
const VALID_REASONS = new Set(['session_expired', 'missing_scope']);

function browserWindow() {
    return typeof window === 'undefined' ? null : window;
}

export function sanitizeLoginUrl(value) {
    const win = browserWindow();
    const origin = win?.location?.origin;
    if (!origin || typeof value !== 'string' || !value.trim() || value.startsWith('//')) {
        return FALLBACK_LOGIN_URL;
    }
    try {
        const parsed = new URL(value, origin);
        if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/login' || parsed.hash) {
            return FALLBACK_LOGIN_URL;
        }
        if ([...parsed.searchParams.keys()].some(key => key !== 'reason')) return FALLBACK_LOGIN_URL;
        const reasons = parsed.searchParams.getAll('reason');
        if (reasons.length > 1) return FALLBACK_LOGIN_URL;
        if (reasons.length === 1 && !VALID_REASONS.has(reasons[0])) return FALLBACK_LOGIN_URL;
        return reasons.length === 1 ? `/login?reason=${reasons[0]}` : '/login';
    } catch (error) {
        return FALLBACK_LOGIN_URL;
    }
}

function stateFor(loginUrl) {
    const safeUrl = sanitizeLoginUrl(loginUrl);
    const reason = safeUrl.includes('reason=missing_scope') ? 'missing_scope' : 'session_expired';
    return Object.freeze({ locked: true, loginUrl: safeUrl, reason });
}

export class AuthenticationRequiredError extends Error {
    constructor(state = null, status = 401) {
        super('Authentication is required to continue.');
        this.name = 'AuthenticationRequiredError';
        this.code = AUTHENTICATION_REQUIRED_CODE;
        const normalizedStatus = Number(status);
        this.status = Number.isFinite(normalizedStatus) ? normalizedStatus : 401;
        this.loginUrl = state?.loginUrl || FALLBACK_LOGIN_URL;
    }
}

export function isAuthenticationRequiredError(error) {
    return error instanceof AuthenticationRequiredError || error?.name === 'AuthenticationRequiredError';
}

export function readPendingAuthenticationRequired() {
    const win = browserWindow();
    const value = win?.[AUTH_REQUIRED_SLOT];
    return value?.locked === true ? value : null;
}

export function publishAuthenticationRequired(payload = {}) {
    const win = browserWindow();
    if (!win) return stateFor(payload?.loginUrl);
    const existing = readPendingAuthenticationRequired();
    if (existing) return existing;
    const next = stateFor(payload?.loginUrl);
    win[AUTH_REQUIRED_SLOT] = next;
    win.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: next }));
    return next;
}
