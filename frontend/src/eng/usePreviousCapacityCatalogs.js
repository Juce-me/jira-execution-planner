import * as React from 'react';
import { fetchSprints } from '../api/engApi.js';
import { validateSiblingSprintCatalog } from '../dashboardRuntime.js';
import { buildConfigurationContext, catalogContextKey, quarterFromSprintName, quarterIndex } from '../workStructure/configurationContext.js';
import { rankPreviousCapacitySprint } from './planningCapacityUtils.js';

// The configurations other than the viewed one whose saved range reaches a quarter earlier than `quarter`; each carries
// its own catalog context, or null when it has no usable one (that source is then unavailable, never skipped). Without a
// viewed configuration context (unpromoted or flag off) the viewed catalog is the only source, as before.
export function earlierCapacitySources(summaries, currentContext, quarter) {
    const index = quarterIndex(quarter);
    if (index === null || !currentContext) return [];
    return (summaries || []).filter(summary => summary?.id && summary.id !== currentContext.id
        && (quarterIndex(summary.fromQuarter) ?? -Infinity) < index)
        .map(summary => buildConfigurationContext(summary, summary.fromQuarter || summary.throughQuarter));
}

const abortError = () => Object.assign(new Error('Previous capacity lookup was aborted.'), { name: 'AbortError' });

// One explicit editor open: read each earlier configuration's catalog once (never a forced refresh), validate it, and rank
// the earlier Sprint across those catalogs and the viewed one. Returns { state, sprint }, state one of ready | none |
// pending | unavailable | ambiguous. An abort or an expired sign-in is thrown, never reported as a state.
export async function resolvePreviousCapacitySprint({ sprintName, summaries, currentContext, currentSprints, getBrowserContextId, read, signal }) {
    const quarter = quarterFromSprintName(sprintName);
    if (!quarter) return { state: 'none', sprint: null };
    const results = await Promise.all(earlierCapacitySources(summaries, currentContext, quarter).map(async (context) => {
        if (!context) return { status: 'unavailable' };
        try {
            const response = await read(context, { signal });
            const body = await response.json().catch(() => null);
            if (signal?.aborted) throw abortError();
            return validateSiblingSprintCatalog({ httpStatus: response.status, ...(body || {}) }, { context, browserContextId: getBrowserContextId() });
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'AuthenticationRequiredError') throw error;
            return { status: 'unavailable' };
        }
    }));
    if (signal?.aborted) throw abortError();
    if (results.some(result => result.status === 'unavailable')) return { state: 'unavailable', sprint: null };
    if (results.some(result => result.status === 'pending')) return { state: 'pending', sprint: null };
    const ranked = rankPreviousCapacitySprint([currentSprints || [], ...results.map(result => result.sprints)], sprintName);
    if (ranked.ambiguous) return { state: 'ambiguous', sprint: null };
    return ranked.sprint ? { state: 'ready', sprint: ranked.sprint } : { state: 'none', sprint: null };
}

// The editor's lookup-private previous-Sprint resolver. Its identity changes with the viewed configuration, the saved
// configuration revisions or the browser context, so an editor open in flight can fence on it. Reads happen only on call.
export function usePreviousCapacityCatalogs({ backendUrl, summaries, currentContext, currentSprints, browserContextId }) {
    const latest = React.useRef(null);
    latest.current = { summaries, currentContext, currentSprints, browserContextId };
    const signature = [catalogContextKey(currentContext), browserContextId || '',
        ...(summaries || []).map(summary => [summary?.id, summary?.revision, summary?.digest, summary?.fromQuarter, summary?.throughQuarter].join('|'))].join('\n');
    return React.useCallback((sprintName, { signal } = {}) => resolvePreviousCapacitySprint({
        sprintName, ...latest.current, signal,
        getBrowserContextId: () => latest.current.browserContextId,
        read: (context, options) => fetchSprints(backendUrl, { context, signal: options.signal }),
    }), [backendUrl, signature]);
}
