import { getJson, postJson } from './http.js';

// Operational diagnostics are intentionally outside product analytics.
export const fetchPerformanceContext = (backendUrl, options = {}) =>
    getJson(`${backendUrl}/api/performance/context`, 'Performance collection', { cache: 'no-store', ...options });

export async function recordPerformanceLoad(backendUrl, observation) {
    const { csrfToken } = await getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', { cache: 'no-store' });
    return postJson(`${backendUrl}/api/performance/loads`, observation, 'Performance observation', {
        headers: { 'X-CSRF-Token': csrfToken || '' },
    });
}

export function fetchAdminPerformance(backendUrl, filters = {}, options = {}) {
    const query = new URLSearchParams();
    for (const key of ['groupId', 'sprintId', 'cacheState', 'revision']) {
        if (filters[key]) query.set(key, filters[key]);
    }
    return getJson(`${backendUrl}/api/admin/performance?${query}`, 'Performance history', {
        cache: 'no-store', ...options,
    });
}
