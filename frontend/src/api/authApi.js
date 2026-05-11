import { getJson, json, postJson } from './http.js';

const homeTokenUrl = (backendUrl) => `${backendUrl}/api/me/connections/home-token`;

export const fetchAuthStatus = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/status`, 'Auth status', { cache: 'no-cache' });

export const fetchHomeTokenConnection = (backendUrl) =>
    getJson(homeTokenUrl(backendUrl), 'Home token connection', { cache: 'no-cache' });

export const fetchCsrfToken = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', { cache: 'no-cache' });

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
        },
    ));
}

export function deleteHomeTokenConnection(backendUrl) {
    return fetchCsrfToken(backendUrl).then(({ csrfToken }) => fetch(homeTokenUrl(backendUrl), {
        method: 'DELETE',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': csrfToken || '',
        },
    }).then(response => json(response, 'Home token connection')));
}
