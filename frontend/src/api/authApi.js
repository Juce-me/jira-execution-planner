import { getJson, json, postJson, trackedFetch } from './http.js';

const homeTokenUrl = (backendUrl) => `${backendUrl}/api/me/connections/home-token`;

export const fetchAuthStatus = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/status`, 'Auth status', {
        cache: 'no-cache',
        analytics: { apiSurface: 'auth_status', featureName: 'auth' },
    });

export const fetchHomeTokenConnection = (backendUrl) =>
    getJson(homeTokenUrl(backendUrl), 'Home token connection', {
        cache: 'no-cache',
        analytics: { apiSurface: 'home_connection', featureName: 'connections' },
    });

export const fetchCsrfToken = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', { cache: 'no-cache' });

export const refreshAuthSession = (backendUrl) =>
    fetch(`${backendUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-cache',
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    });

export function connectHomeTokenConnection(backendUrl, payload) {
    return fetchCsrfToken(backendUrl).then(({ csrfToken }) => postJson(
        homeTokenUrl(backendUrl),
        {
            email: payload?.email || '',
            apiToken: payload?.apiToken || '',
        },
        'Home token connection',
        {
            cache: 'no-cache',
            headers: { 'X-CSRF-Token': csrfToken || '' },
            analytics: { apiSurface: 'home_connection', featureName: 'connections' },
        },
    ));
}

export function deleteHomeTokenConnection(backendUrl) {
    return fetchCsrfToken(backendUrl).then(({ csrfToken }) => trackedFetch('home_connection', homeTokenUrl(backendUrl), {
        method: 'DELETE',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': csrfToken || '',
        },
    }, { featureName: 'connections' }).then(response => json(response, 'Home token connection')));
}
