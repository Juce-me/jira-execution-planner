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

// Indefinite article for an entity name: 'an' before a vowel, or before an acronym (two leading capitals) whose first
// letter is spoken with a vowel sound ("an OKR", "an SLA", but "a UX goal"); 'a' otherwise. Capitalise at sentence start.
export function entityArticle(word) {
    const text = String(word || '');
    return (/^[A-Z]{2}/.test(text) ? /^[AEFHILMNORSX]/ : /^[aeiou]/i).test(text) ? 'an' : 'a';
}

const LEVEL_KINDS = ['story', 'epic', 'initiative'];
const kindForLevel = level => (level >= 3 ? 'objective' : LEVEL_KINDS[Math.max(0, level)]);

const MODEL_DEFAULTS = {
    [WORK_MODEL_LEGACY]: { planning: ['Story', 0], parent: ['Epic', 1], ancestor: ['Initiative', 2], optionalAncestor: [null, 3] },
    [WORK_MODEL_RND_2027]: { planning: ['Epic', 1], parent: ['Initiative', 2], ancestor: ['Objective', 3], optionalAncestor: ['Strategy', 4] },
};

const typeName = slot => (typeof slot?.name === 'string' && slot.name.trim() ? slot.name.trim() : null);
const typeLevel = slot => (Number.isInteger(slot?.hierarchyLevel) ? slot.hierarchyLevel : null);
const typeId = slot => (typeof slot?.id === 'string' && /^\d{1,18}$/.test(slot.id) ? slot.id : null);

// Captured levels ([child, parent, ancestor], each an int or null) must strictly increase where present, or every
// level takes the model default. A missing slot keeps its default when that still fits between its neighbours;
// otherwise a missing child sits one below the parent, a missing parent one above the child and a missing ancestor
// one above the parent.
function resolveLevels(captured, defaults) {
    const known = captured.filter(level => level != null);
    if (known.some((level, index) => index > 0 && known[index - 1] >= level)) return defaults;
    const above = index => captured.slice(index + 1).find(level => level != null) ?? null;
    const child = captured[0] ?? (above(0) == null || defaults[0] < above(0) ? defaults[0] : above(0) - 1);
    const parent = captured[1] ?? (defaults[1] > child && (above(1) == null || defaults[1] < above(1)) ? defaults[1] : child + 1);
    const ancestor = captured[2] ?? parent + 1;
    return child < parent && parent < ancestor ? [child, parent, ancestor] : defaults;
}

// The names and kinds the ENG surfaces use for each work role. `roleTypes` is the configuration summary's capture
// ({planning, parent, ancestor, optionalAncestor}, each null or {id, name, hierarchyLevel});
// `observed` ({digest, planning, parent}) is what a full Catch Up read saw and wins only for the same digest.
// Missing names fall back to the model defaults; levels follow `resolveLevels`. Ids are read only for the new
// model's type icons (`*TypeId`); Legacy draws the level glyphs.
export function resolveEntityNames(model, roleTypes = null, observed = null, digest = null) {
    const normalized = normalizeWorkModel(model);
    const defaults = MODEL_DEFAULTS[normalized];
    const seen = observed && digest != null && observed.digest === digest ? observed : null;
    const name = role => (role === 'planning' || role === 'parent' ? typeName({ name: seen?.[role] }) : null)
        || typeName(roleTypes?.[role]) || defaults[role][0];
    const levels = resolveLevels(['planning', 'parent', 'ancestor'].map(role => typeLevel(roleTypes?.[role])),
        ['planning', 'parent', 'ancestor'].map(role => defaults[role][1]));
    const [child, parent, ancestor] = ['planning', 'parent', 'ancestor'].map(name);
    return {
        model: normalized,
        child, childPlural: pluralizeEntityName(child),
        parent, parentPlural: pluralizeEntityName(parent),
        ancestor, ancestorPlural: pluralizeEntityName(ancestor),
        optionalAncestor: name('optionalAncestor'),
        childKind: kindForLevel(levels[0]), parentKind: kindForLevel(levels[1]), ancestorKind: kindForLevel(levels[2]),
        childLevel: levels[0], parentLevel: levels[1], ancestorLevel: levels[2],
        ...Object.fromEntries(['child', 'parent', 'ancestor'].map((key, index) => [`${key}TypeId`,
            normalized === WORK_MODEL_RND_2027 ? typeId(roleTypes?.[['planning', 'parent', 'ancestor'][index]]) : null])),
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
