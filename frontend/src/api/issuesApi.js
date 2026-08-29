import { apiFetch } from './http.js';

export const fetchIssuesLookup = (backendUrl, keys, { signal } = {}) =>
    apiFetch(`${backendUrl}/api/issues/lookup?keys=${encodeURIComponent((keys || []).join(','))}`, {
        signal
    });
