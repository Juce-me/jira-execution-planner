import { fetchCsrfToken } from './authApi.js';
import { getJson, jsonOrStructuredError, trackedFetch } from './http.js';

const mutationHeaders = (csrfToken) => ({
    'X-Requested-With': 'jira-execution-planner',
    'X-CSRF-Token': csrfToken || '',
});

export const fetchAdminUsers = (backendUrl) =>
    getJson(`${backendUrl}/api/admin/users`, 'Admin users', { cache: 'no-cache' });

export async function saveAdminMembership(backendUrl, changes) {
    if (!changes.length) return [];
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return Promise.all(changes.map(({ userId, isAdmin }) => {
        const encodedUserId = encodeURIComponent(String(userId || ''));
        return trackedFetch('settings_save', `${backendUrl}/api/admin/users/${encodedUserId}/admin-grant`, {
            method: isAdmin ? 'POST' : 'DELETE',
            cache: 'no-cache',
            headers: mutationHeaders(csrfToken),
        }, { featureName: 'settings' }).then(response => jsonOrStructuredError(response, 'Admin membership update'));
    }));
}
