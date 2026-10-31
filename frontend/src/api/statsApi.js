import { trackedFetch } from './http.js';
import { sameCatalogContext } from '../workStructure/configurationContext.js';
import { getActiveWorkContext, runInWorkContext, stampBody } from '../workStructure/requestContext.js';

// Lead Times answers per configuration, not per viewed quarter: a quarter change inside one unchanged
// configuration keeps its in-flight window; an era or revision change drops the late completion as an abort.
async function runInCatalogContext(init, start) {
    const context = getActiveWorkContext();
    const response = await start(init);
    if (context && !sameCatalogContext(context, getActiveWorkContext())) {
        throw Object.assign(new Error('The work configuration changed.'), { name: 'AbortError', code: 'configuration_context_changed' });
    }
    return response;
}

const statsPostOptions = (payload, signal) => ({
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'jira-execution-planner'
    },
    cache: 'no-cache',
    signal,
    body: JSON.stringify(payload)
});

export const fetchBurnoutStats = (backendUrl, payload, { signal, suppressAbortResult = false } = {}) =>
    trackedFetch('stats_source', `${backendUrl}/api/stats/burnout`, statsPostOptions(payload, signal), { featureName: 'stats', suppressAbortResult });

export const fetchEpicCohortStats = (backendUrl, payload, { signal, suppressAbortResult = false } = {}) =>
    runInCatalogContext({}, () => trackedFetch('stats_source', `${backendUrl}/api/stats/epic-cohort`, statsPostOptions(payload, signal), { featureName: 'stats', suppressAbortResult }));

export const fetchProjectTrackPhaseDurations = (backendUrl, { epicKeys = [], refresh = false, signal } = {}) =>
    runInWorkContext({ signal }, next => trackedFetch(
        'stats_source',
        `${backendUrl}/api/stats/project-track-phase-durations`,
        statsPostOptions(stampBody({ epicKeys, ...(refresh ? { refresh: true } : {}) }), next.signal),
        { featureName: 'stats' }
    ));
