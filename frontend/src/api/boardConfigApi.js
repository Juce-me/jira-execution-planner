import { jsonOrStructuredError, trackedFetch } from './http.js';

const headers = () => ({
    'X-Requested-With': 'jira-execution-planner',
});

export function fetchEpicDescription(backendUrl, { key, signal } = {}) {
    const params = new URLSearchParams({ key: String(key || '') });
    return trackedFetch('eng_issue_description', `${backendUrl}/api/issues/description?${params.toString()}`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: headers(),
    }, { featureName: 'eng_epic_description' }).then(response => jsonOrStructuredError(response, 'Epic description'));
}

// After promotion the statuses read names its stored entry explicitly: id, revision and, when the
// caller knows it, the quarter that must resolve to that id. Without a selector the request is the
// unchanged Legacy flat read.
export function fetchBoardStatuses(backendUrl, { signal, configurationId = '', configurationRevision = null, quarter = '' } = {}) {
    const params = new URLSearchParams();
    if (configurationId) {
        params.set('configurationId', String(configurationId));
        params.set('configurationRevision', String(configurationRevision ?? ''));
        if (quarter) params.set('quarter', String(quarter));
    }
    const query = params.toString();
    return trackedFetch('board_config_statuses', `${backendUrl}/api/board-config/statuses${query ? `?${query}` : ''}`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: headers(),
    }, { featureName: 'group_board_composer' }).then(response => jsonOrStructuredError(response, 'Board statuses'));
}
