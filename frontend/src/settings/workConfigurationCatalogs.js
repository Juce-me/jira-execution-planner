import { fetchWorkIssueTypes } from '../api/configApi.js';
import { catalogScopeKey } from './boardStatusCatalog.js';
import { normalizeIssueTypes } from './workConfigurationModel.js';

// Client cache for the saved-entry issue-type catalog: one in-flight/settled answer per
// configuration id + revision + digest + mapped parent authority. Failures are never cached (a
// retry must be possible) and the request is not tied to a caller signal so a settled answer is
// stored once; consumers drop late answers by comparing the key they asked for.
const typeCatalogs = new Map();

export function loadIssueTypeCatalog(backendUrl, scope) {
    const key = `${backendUrl}::types::${catalogScopeKey(scope)}`;
    const cached = typeCatalogs.get(key);
    if (cached) return cached;
    const pending = fetchWorkIssueTypes(backendUrl, scope)
        .then(async response => {
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                const error = new Error(payload?.message || `Issue types fetch error ${response.status}`);
                error.status = response.status;
                error.code = payload?.error || '';
                throw error;
            }
            if (payload?.configurationId && String(payload.configurationId) !== String(scope.configurationId)) {
                const error = new Error('The issue-type catalog answered for another configuration.');
                error.code = 'configuration_scope_changed';
                throw error;
            }
            return { types: normalizeIssueTypes(payload?.issueTypes), key };
        })
        .catch(error => {
            typeCatalogs.delete(key);
            throw error;
        });
    typeCatalogs.set(key, pending);
    return pending;
}

export const issueTypeCatalogKey = (backendUrl, scope) => `${backendUrl}::types::${catalogScopeKey(scope)}`;

export function clearWorkCatalogCache() {
    typeCatalogs.clear();
}
