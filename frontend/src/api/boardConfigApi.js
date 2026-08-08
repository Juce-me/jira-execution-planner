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

export function fetchBoardStatuses(backendUrl, { signal } = {}) {
    return trackedFetch('board_config_statuses', `${backendUrl}/api/board-config/statuses`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: headers(),
    }, { featureName: 'group_board_composer' }).then(response => jsonOrStructuredError(response, 'Board statuses'));
}
