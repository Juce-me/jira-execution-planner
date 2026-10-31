// Pure labels for the work-configuration scope a statistics view answers for. No view claims that Story
// Points of different configurations are equivalent; each names its own quarter, model and role words.

import { MODEL_LEGACY, canonicalQuarter, quarterFromSprintName, quarterInRange } from '../workStructure/configurationContext.js';

// Role words the grouping parent and its child carry in each model.
export function roleLabels(model) {
    return model === MODEL_LEGACY || !model
        ? { parent: 'Epic', parents: 'Epics', child: 'Story', children: 'Stories' }
        : { parent: 'Initiative', parents: 'Initiatives', child: 'Epic', children: 'Epics' };
}

// "2027Q1 · DELIVERY" style label for the selected quarter; null before promotion (nothing to name).
export function describeStatsScope(workContext, summaries) {
    if (!workContext) return null;
    const summary = (Array.isArray(summaries) ? summaries : []).find(item => item?.id === workContext.id) || null;
    const model = summary?.model || null;
    const name = String(summary?.name || '').trim();
    return {
        quarter: workContext.quarter,
        configurationName: name,
        model,
        roles: model ? roleLabels(model) : null,
        label: name ? `${workContext.quarter} · ${name}` : workContext.quarter,
    };
}

// Sprint periods whose source failed or is missing are "unavailable"; only a loaded period with no work is zero.
export function classifyPeriods(periods, loadedSprintIds, failedSprintIds) {
    const loaded = new Set((loadedSprintIds || []).map(String));
    const failed = new Set((failedSprintIds || []).map(String));
    return (periods || []).map((period) => {
        const id = String(period?.id ?? '');
        const state = failed.has(id) || !loaded.has(id) ? 'unavailable' : 'loaded';
        return { id, name: period?.name || id, quarter: quarterFromSprintName(period?.name), state };
    });
}

export const unavailablePeriodNames = classified => classified.filter(item => item.state === 'unavailable').map(item => item.name);

// Server-reported unavailable spans (`meta.unavailablePeriods`: configuration segments of a mixed-era range
// whose setup is incomplete) are kept apart from zero work. Each entry is `{startQuarter, endQuarter, configurationId, reason}`.
export function unavailablePeriodSpans(meta) {
    const raw = Array.isArray(meta?.unavailablePeriods) ? meta.unavailablePeriods : [];
    return raw.flatMap((item) => {
        const start = canonicalQuarter(item?.startQuarter);
        const end = canonicalQuarter(item?.endQuarter);
        if (!start || !end) return [];
        return [{ startQuarter: start, endQuarter: end, configurationId: String(item.configurationId || ''), reason: String(item.reason || ''), label: start === end ? start : `${start}\u2013${end}` }];
    });
}

// Whether a Sprint belongs to the viewed configuration, so selectors may be sent only for ids it answers for.
export function sprintInContext(sprint, context) {
    const quarter = quarterFromSprintName(sprint?.name);
    return Boolean(context && quarter && quarterInRange(quarter, context));
}

// Null Story Points display as 0 SP; the missing information is reported next to it, never discarded.
export function displayStoryPoints(value) {
    const missing = value === null || value === undefined;
    return { text: `${missing ? 0 : value} SP`, missing };
}
