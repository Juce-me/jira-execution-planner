import { apiFetch, getJson } from './http.js';

export const fetchAuthStatus = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/status`, 'Auth status', {
        cache: 'no-cache',
        analytics: { apiSurface: 'auth_status', featureName: 'auth' },
    });

export const fetchCsrfToken = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', { cache: 'no-cache' });

export const refreshAuthSession = (backendUrl) =>
    apiFetch(`${backendUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-cache',
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    });
