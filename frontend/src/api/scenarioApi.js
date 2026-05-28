async function scenarioJson(response, label) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.message || payload.error || `${label} error ${response.status}`);
        error.payload = payload;
        error.status = response.status;
        throw error;
    }
    return payload;
}

const scenarioPostHeaders = (csrfToken = '') => ({
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
    'X-CSRF-Token': csrfToken
});

const scenarioDraftUrl = (backendUrl, draftId, path = '') =>
    `${backendUrl}/api/scenario/drafts/${encodeURIComponent(draftId)}${path}`;

export const fetchScenarioDraft = (backendUrl, scopeKey, { signal } = {}) =>
    fetch(`${backendUrl}/api/scenario/drafts?scope_key=${encodeURIComponent(scopeKey)}`, {
        cache: 'no-cache',
        signal
    }).then(response => scenarioJson(response, 'Scenario draft'));

export const postScenarioRealtimeJson = (backendUrl, draftId, path, payload, { csrfToken = '' } = {}) =>
    fetch(scenarioDraftUrl(backendUrl, draftId, path), {
        method: 'POST',
        cache: 'no-cache',
        headers: scenarioPostHeaders(csrfToken),
        body: JSON.stringify(payload)
    }).then(response => scenarioJson(response, 'Scenario realtime'));

export const pollScenarioDraftEvents = (backendUrl, draftId, sinceEventNumber, { signal } = {}) =>
    fetch(scenarioDraftUrl(backendUrl, draftId, `/events?since=${encodeURIComponent(sinceEventNumber || 0)}`), {
        cache: 'no-cache',
        signal
    }).then(response => scenarioJson(response, 'Scenario draft events')).then(data => ({
        events: Array.isArray(data.events) ? data.events : [],
        nextSince: Number(data.nextSince || 0)
    }));

export const saveScenarioDraftVersion = (backendUrl, payload, { csrfToken = '' } = {}) =>
    fetch(`${backendUrl}/api/scenario/drafts`, {
        method: 'POST',
        cache: 'no-cache',
        headers: scenarioPostHeaders(csrfToken),
        body: JSON.stringify(payload)
    }).then(response => scenarioJson(response, 'Scenario draft save'));

export const fetchScenarioDraftVersion = (backendUrl, draftId, versionNumber, { signal } = {}) =>
    fetch(scenarioDraftUrl(backendUrl, draftId, `/versions/${encodeURIComponent(versionNumber)}`), {
        cache: 'no-cache',
        signal
    }).then(response => scenarioJson(response, 'Scenario draft version'));

export const rollbackScenarioDraft = (backendUrl, draftId, payload, { csrfToken = '', signal } = {}) =>
    fetch(scenarioDraftUrl(backendUrl, draftId, '/rollback'), {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: scenarioPostHeaders(csrfToken),
        body: JSON.stringify(payload)
    }).then(response => scenarioJson(response, 'Scenario draft rollback'));

export const reloadScenarioDraftFromJira = (backendUrl, draftId, payload, { csrfToken = '', signal } = {}) =>
    fetch(scenarioDraftUrl(backendUrl, draftId, '/reload-from-jira'), {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: scenarioPostHeaders(csrfToken),
        body: JSON.stringify(payload)
    }).then(response => scenarioJson(response, 'Scenario draft reload'));

export const fetchScenarioRun = (backendUrl, payload, { signal } = {}) =>
    fetch(`${backendUrl}/api/scenario`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner'
        },
        body: JSON.stringify(payload),
        signal
    }).then(response => scenarioJson(response, 'Scenario'));

export const buildScenarioDraftEventsStreamUrl = (backendUrl, draftId, sinceEventNumber = 0) =>
    scenarioDraftUrl(backendUrl, draftId, `/events/stream?since=${encodeURIComponent(sinceEventNumber || 0)}`);
