// Work-structure model identity for the ENG surfaces. The server owns the model (`legacy` or `rnd_2027`)
// and returns it, with the accepted configuration context, on every work response. This module only
// interprets it: names the entities and says whether the one-lane combined classification applies.
// No React, no I/O.

export const WORK_MODEL_LEGACY = 'legacy';
export const WORK_MODEL_RND_2027 = 'rnd_2027';

export const isCombinedWorkModel = model => model === WORK_MODEL_RND_2027;

export const normalizeWorkModel = model => (isCombinedWorkModel(model) ? WORK_MODEL_RND_2027 : WORK_MODEL_LEGACY);

// Actual Jira entity names per role: `child` is the planning leaf, `parent` the grouping level.
export function workEntityNames(model) {
    return isCombinedWorkModel(model)
        ? { child: 'Epic', childPlural: 'Epics', parent: 'Initiative', parentPlural: 'Initiatives' }
        : { child: 'Story', childPlural: 'Stories', parent: 'Epic', parentPlural: 'Epics' };
}

// The accepted configuration context a work response carries: {id, revision, quarter, digest}.
export function readWorkContext(payload) {
    const context = payload?.configuration || payload?.workContext || null;
    return context && typeof context === 'object' ? context : null;
}
