// Work-structure model identity for the ENG surfaces. The server owns the model (`legacy` or `rnd_2027`)
// and returns it, with the accepted configuration context, on every work response. This module only
// interprets it: names the entities and says whether the one-lane combined classification applies.
// No React, no I/O.

export const WORK_MODEL_LEGACY = 'legacy';
export const WORK_MODEL_RND_2027 = 'rnd_2027';

export const isCombinedWorkModel = model => model === WORK_MODEL_RND_2027;

export const normalizeWorkModel = model => (isCombinedWorkModel(model) ? WORK_MODEL_RND_2027 : WORK_MODEL_LEGACY);

// Plural of a Jira type name: all-caps or a non-letter ending takes `s` (OKRs, Q&As); consonant + y takes `ies`;
// s/x/z/ch/sh take `es`; everything else `s`.
export function pluralizeEntityName(name) {
    const word = String(name || '');
    if (!/[a-z]/.test(word) || /[^A-Za-z]$/.test(word)) return `${word}s`;
    if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
    if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
    return `${word}s`;
}

// Lowercase for running text, except names with two consecutive capitals (acronyms such as OKR).
export const lowerEntityWord = word => (/[A-Z]{2}/.test(String(word || '')) ? String(word) : String(word || '').toLowerCase());

const LEVEL_KINDS = ['story', 'epic', 'initiative'];
const kindForLevel = level => (level >= 3 ? 'objective' : LEVEL_KINDS[Math.max(0, level)]);

const MODEL_DEFAULTS = {
    [WORK_MODEL_LEGACY]: { planning: ['Story', 0], parent: ['Epic', 1], ancestor: ['Initiative', 2], optionalAncestor: [null, 3] },
    [WORK_MODEL_RND_2027]: { planning: ['Epic', 1], parent: ['Initiative', 2], ancestor: ['Objective', 3], optionalAncestor: ['Strategy', 4] },
};

const typeName = slot => (typeof slot?.name === 'string' && slot.name.trim() ? slot.name.trim() : null);
const typeLevel = slot => (Number.isInteger(slot?.hierarchyLevel) ? slot.hierarchyLevel : null);

// The names and kinds the ENG surfaces use for each work role. `roleTypes` is the configuration summary's capture
// ({planning, parent, ancestor, optionalAncestor}, each null or {id, name, hierarchyLevel}; ids are never read);
// `observed` ({digest, planning, parent}) is what a full Catch Up read saw and wins only for the same digest.
// Missing names fall back to the model defaults; levels are used only when child < parent < ancestor strictly.
export function resolveEntityNames(model, roleTypes = null, observed = null, digest = null) {
    const normalized = normalizeWorkModel(model);
    const defaults = MODEL_DEFAULTS[normalized];
    const seen = observed && digest != null && observed.digest === digest ? observed : null;
    const name = role => (role === 'planning' || role === 'parent' ? typeName({ name: seen?.[role] }) : null)
        || typeName(roleTypes?.[role]) || defaults[role][0];
    const captured = ['planning', 'parent', 'ancestor'].map(role => typeLevel(roleTypes?.[role]) ?? defaults[role][1]);
    const levels = captured[0] < captured[1] && captured[1] < captured[2] ? captured : ['planning', 'parent', 'ancestor'].map(role => defaults[role][1]);
    const [child, parent, ancestor] = ['planning', 'parent', 'ancestor'].map(name);
    return {
        model: normalized,
        child, childPlural: pluralizeEntityName(child),
        parent, parentPlural: pluralizeEntityName(parent),
        ancestor, ancestorPlural: pluralizeEntityName(ancestor),
        optionalAncestor: name('optionalAncestor'),
        childKind: kindForLevel(levels[0]), parentKind: kindForLevel(levels[1]), ancestorKind: kindForLevel(levels[2]),
        childLevel: levels[0], parentLevel: levels[1], ancestorLevel: levels[2],
    };
}

// "1 Epic", "0 Epics": 1 is singular, every other number plural. `role` is 'child', 'parent' or 'ancestor'.
export const formatEntityCount = (count, names, role) => `${count} ${count === 1 ? names[role] : names[`${role}Plural`]}`;

// Model-default names only (no configured types); kept for callers not yet given EntityNames.
export function workEntityNames(model) {
    const { child, childPlural, parent, parentPlural } = resolveEntityNames(model);
    return { child, childPlural, parent, parentPlural };
}

// The accepted configuration context a work response carries: {id, revision, quarter, digest}.
export function readWorkContext(payload) {
    const context = payload?.configuration || payload?.workContext || null;
    return context && typeof context === 'object' ? context : null;
}
