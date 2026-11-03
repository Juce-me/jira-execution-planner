import { useEffect, useMemo, useState } from 'react';
import { buildConfigurationContext, catalogContextKey, quarterFromSprintName } from './configurationContext.js';

const STATE_RANK = { active: 0, closed: 1, future: 2 };

// The configurations other than the viewed one, each with its own catalog context (id, revision, digest).
export function siblingCatalogs(summaries, currentContext) {
    const currentId = currentContext?.id || '';
    return (summaries || []).flatMap((summary) => {
        if (!summary?.id || summary.id === currentId) return [];
        const context = buildConfigurationContext(summary, summary.fromQuarter || summary.throughQuarter);
        return context ? [{ key: catalogContextKey(context), id: context.id, context }] : [];
    });
}

// Quarter -> best Sprint state ('active' > 'closed' > 'future') of one sibling's own rows. A body that is not a catalog
// answer is no observation (null), so it never stands in for an empty catalog.
export function siblingStatesFromBody(body, configurationId) {
    if (!Array.isArray(body?.sprints)) return null;
    const states = {};
    body.sprints.filter(row => row?.configurationId === configurationId).forEach((row) => {
        const quarter = quarterFromSprintName(row.name);
        const state = String(row.state || '').toLowerCase();
        if (quarter && (!(quarter in states) || (STATE_RANK[state] ?? 3) < (STATE_RANK[states[quarter]] ?? 3))) states[quarter] = state;
    });
    return states;
}

// Only observations of the siblings' current catalog identities count; an older revision's quarters are never shown.
export function visibleSiblingStates(observations, catalogs) {
    const merged = {};
    catalogs.forEach(({ key }) => {
        Object.entries(observations?.[key] || {}).forEach(([quarter, state]) => {
            if (!(quarter in merged) || (STATE_RANK[state] ?? 3) < (STATE_RANK[merged[quarter]] ?? 3)) merged[quarter] = state;
        });
    });
    return merged;
}

// Quarter -> Sprint state of the configurations other than the viewed one, so the dropdown marks every Sprint alike.
// Each answer replaces that catalog identity's observation; a failed read removes it, leaving that sibling unmarked.
export function useSiblingQuarterStates({ summaries, currentContext, read }) {
    const [observations, setObservations] = useState({});
    const catalogs = siblingCatalogs(summaries, currentContext);
    const key = catalogs.map(catalog => catalog.key).join('|');
    useEffect(() => {
        let cancelled = false;
        const keep = new Set(catalogs.map(catalog => catalog.key));
        setObservations(previous => Object.fromEntries(Object.entries(previous).filter(([catalogKey]) => keep.has(catalogKey))));
        catalogs.forEach(async ({ key: catalogKey, id, context }) => {
            let states = null;
            try {
                const response = await read(context);
                states = response?.ok === false ? null : siblingStatesFromBody(await response.json(), id);
            } catch (error) { states = null; }
            if (cancelled) return;
            setObservations((previous) => {
                const next = { ...previous };
                if (states) next[catalogKey] = states;
                else delete next[catalogKey];
                return next;
            });
        });
        return () => { cancelled = true; };
    }, [key]);
    return useMemo(() => visibleSiblingStates(observations, catalogs), [observations, key]);
}
