import { fetchCsrfToken } from './authApi.js';
import { trackedFetch } from './http.js';

const CAPACITY_ANALYTICS = {
    featureName: 'planning_capacity_edit',
    suppressAbortResult: true,
};

function capacityError(response, errorData) {
    const code = typeof errorData?.error === 'string' && errorData.error
        ? errorData.error
        : 'jira_capacity_update_failed';
    const error = new Error(code);
    error.status = response.status;
    error.code = code;

    if (typeof errorData?.loginUrl === 'string') {
        error.loginUrl = errorData.loginUrl;
    }
    if (typeof errorData?.recoveryUrl === 'string') {
        error.recoveryUrl = errorData.recoveryUrl;
    }
    if (code === 'capacity_conflict' && (
        errorData?.currentCapacity === null ||
        (Number.isFinite(errorData?.currentCapacity) && errorData.currentCapacity >= 0)
    )) {
        error.currentCapacity = errorData.currentCapacity;
    }
    return error;
}

async function capacityJsonOrError(response) {
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw capacityError(response, errorData);
    }
    return response.json();
}

export function fetchCapacity(backendUrl, { sprintName, teams = [], signal } = {}) {
    const params = new URLSearchParams({
        sprint: sprintName,
        t: Date.now().toString(),
    });
    if (teams.length) {
        params.append('teams', teams.join(','));
    }
    return trackedFetch('jira_team_capacity', `${backendUrl}/api/capacity?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal,
    }, CAPACITY_ANALYTICS);
}

export async function updateCapacity(backendUrl, issueKey, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    const body = {
        sprintName: payload?.sprintName,
        teamName: payload?.teamName,
        expectedCapacity: payload?.expectedCapacity,
        capacity: payload?.capacity,
    };
    const response = await trackedFetch(
        'jira_team_capacity',
        `${backendUrl}/api/capacity/${encodeURIComponent(issueKey)}`,
        {
            method: 'PATCH',
            cache: 'no-cache',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'jira-execution-planner',
                'X-CSRF-Token': csrfToken || '',
            },
            body: JSON.stringify(body),
        },
        CAPACITY_ANALYTICS,
    );
    return capacityJsonOrError(response);
}
