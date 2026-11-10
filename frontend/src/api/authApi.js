import { apiFetch, getJson } from './http.js';

export const fetchAuthStatus = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/status`, 'Auth status', {
        cache: 'no-cache',
        analytics: { apiSurface: 'auth_status', featureName: 'auth' },
    });

// Each token is single-use: fetch a fresh one for every write and never share or cache it.
export const fetchCsrfToken = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', {
        cache: 'no-cache',
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    });

export const refreshAuthSession = (backendUrl) =>
    apiFetch(`${backendUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-cache',
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    });
