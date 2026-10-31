// Pure draft/patch/validation/save-request logic for the quarterly Project config editor.
// The server owns ids, models, revisions, promotion and captured compatibility metadata
// (backend/services/work_structure.py); this module only edits the fields the editor owns and
// derives the exact request bodies. No React, no I/O.

export const MODEL_LEGACY = 'legacy';
export const MODEL_RND = 'rnd_2027';
export const DELIVERY_PROJECT_LIMIT_MESSAGE = 'DELIVERY uses one Jira project';

export const HIERARCHY_SLOTS = ['planningIssueTypeId', 'parentIssueTypeId', 'ancestorIssueTypeId', 'optionalAncestorIssueTypeId'];
export const MODE_SLOTS = { parent: 'parentIssueTypeId', ancestor: 'ancestorIssueTypeId' };
export const LEGACY_FIELDS = ['sprint', 'storyPoints', 'parentName', 'team', 'projectTrack', 'deliveryOwner'];
export const RND_FIELDS = [...LEGACY_FIELDS, 'allocation'];
export const REQUIRED_FIELDS = { sprint: 'Sprint', storyPoints: 'Story Points', team: 'Team' };
export const BLANK_FIELD = Object.freeze({ fieldId: '', fieldName: '' });

const QUARTER = /^[0-9]{4}Q[1-4]$/;
export const QUARTER_MESSAGE = 'Use YYYYQ1–YYYYQ4 with a calendar year from 0001 to 9999; no spaces or lowercase.';

export const isValidQuarter = value => value === null
    || (typeof value === 'string' && QUARTER.test(value) && Number(value.slice(0, 4)) >= 1);
export const quarterIndex = value => Number(value.slice(0, 4)) * 4 + Number(value.slice(-1)) - 1;
export const rangeLabel = entry => {
    if (entry.fromQuarter && entry.throughQuarter) return `${entry.fromQuarter} → ${entry.throughQuarter}`;
    if (entry.fromQuarter) return `${entry.fromQuarter} onward`;
    if (entry.throughQuarter) return `Through ${entry.throughQuarter}`;
    return 'All sprints';
};

// Jira entity names for the hierarchy rows, per model (Legacy: Story/Epic/Initiative).
export const hierarchyLabels = model => (model === MODEL_RND
    ? ['Epic', 'Initiative', 'Objective', 'Strategy']
    : ['Story', 'Epic', 'Initiative']);
export const hierarchyLevelOffset = model => (model === MODEL_RND ? 1 : 0);
export const slotsFor = model => HIERARCHY_SLOTS.slice(0, hierarchyLabels(model).length);

export const cloneBundle = bundle => (bundle ? JSON.parse(JSON.stringify(bundle)) : null);
export const entryById = (bundle, id) => (bundle?.configurations || []).find(entry => entry.id === id) || null;

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);

// Applies a field patch (never a whole entry) so a stale mapping callback cannot overwrite an inline
// rename: only keys present in the patch change, nested hierarchy/fields/legacyHierarchyModes merge
// per key, and a Legacy slot patch moves its id and durable mode together.
export function applyEntryPatch(entry, patch) {
    const resolved = typeof patch === 'function' ? patch(entry) : patch;
    if (!isPlain(resolved)) return entry;
    const next = { ...entry };
    for (const [key, value] of Object.entries(resolved)) {
        if (key === 'hierarchy' && isPlain(value)) {
            next.hierarchy = { ...entry.hierarchy };
            for (const [slot, id] of Object.entries(value)) {
                next.hierarchy[slot] = id || null;
                if (entry.model === MODEL_LEGACY) {
                    for (const [modeSlot, slotKey] of Object.entries(MODE_SLOTS)) {
                        if (slotKey === slot) {
                            next.legacyHierarchyModes = { ...(next.legacyHierarchyModes || entry.legacyHierarchyModes), [modeSlot]: 'mapped' };
                        }
                    }
                }
            }
        } else if (key === 'fields' && isPlain(value)) {
            next.fields = { ...entry.fields };
            for (const [name, mapping] of Object.entries(value)) {
                next.fields[name] = { fieldId: mapping?.fieldId || '', fieldName: mapping?.fieldName || '' };
            }
        } else if (key === 'scope' && isPlain(value)) {
            next.scope = { ...entry.scope, ...value };
        } else {
            next[key] = value;
        }
    }
    return next;
}

export function patchBundleEntry(bundle, id, patch) {
    if (!bundle) return bundle;
    return {
        ...bundle,
        configurations: bundle.configurations.map(entry => (entry.id === id ? applyEntryPatch(entry, patch) : entry)),
    };
}

// The single shared rule for adding a Jira project. DELIVERY uses exactly one; Legacy keeps the
// Product/Tech split and its `product` default. Returns {projects, rejected}.
export function addProjectToEntry(entry, key, type) {
    const projects = entry.scope.projects || [];
    if (projects.some(project => project.key === key)) return { projects, rejected: false };
    if (entry.model === MODEL_RND) {
        if (projects.length >= 1) return { projects, rejected: true };
        return { projects: [{ key, type: 'other' }], rejected: false };
    }
    return { projects: [...projects, { key, type: type || 'product' }], rejected: false };
}

export function removeProjectFromEntry(entry, key) {
    return (entry.scope.projects || []).filter(project => project.key !== key);
}

// --- validation ------------------------------------------------------------

export function validateBundle(bundle) {
    const entries = bundle?.configurations || [];
    const errors = Object.fromEntries(entries.map(entry => [entry.id, {}]));
    for (const entry of entries) {
        const name = String(entry.name || '').trim();
        if (!name) errors[entry.id].name = 'Enter a configuration name.';
        else if (name.length > 120) errors[entry.id].name = 'Use at most 120 characters.';
        else if (entries.some(other => other.id !== entry.id && String(other.name || '').trim().toLowerCase() === name.toLowerCase())) {
            errors[entry.id].name = 'Use a different name for each configuration.';
        }
        for (const key of ['fromQuarter', 'throughQuarter']) {
            if (!isValidQuarter(entry[key])) errors[entry.id][key] = QUARTER_MESSAGE;
        }
        if (isValidQuarter(entry.fromQuarter) && isValidQuarter(entry.throughQuarter)
            && entry.fromQuarter && entry.throughQuarter && quarterIndex(entry.fromQuarter) > quarterIndex(entry.throughQuarter)) {
            errors[entry.id].throughQuarter = 'End sprint must not precede start sprint.';
        }
        if (entry.model === MODEL_RND && (entry.scope.projects || []).length > 1) {
            errors[entry.id].projects = DELIVERY_PROJECT_LIMIT_MESSAGE;
        }
    }
    const legacy = entries.find(entry => entry.model === MODEL_LEGACY);
    const delivery = entries.find(entry => entry.model === MODEL_RND);
    if (legacy && delivery && entries.every(entry => !errors[entry.id].fromQuarter && !errors[entry.id].throughQuarter)) {
        if (legacy.fromQuarter) errors[legacy.id].fromQuarter = 'The first configuration must include all earlier sprints.';
        if (delivery.throughQuarter) errors[delivery.id].throughQuarter = 'The last configuration must have no end sprint.';
        if (!legacy.throughQuarter || !delivery.fromQuarter) {
            if (!legacy.throughQuarter) errors[legacy.id].throughQuarter = 'Both inner bounds are required.';
            if (!delivery.fromQuarter) errors[delivery.id].fromQuarter = 'Both inner bounds are required.';
        } else {
            const gap = quarterIndex(delivery.fromQuarter) - quarterIndex(legacy.throughQuarter);
            const message = gap <= 0 ? 'Sprint ranges overlap.' : gap > 1 ? 'Sprint ranges must meet without a gap.' : '';
            if (message) {
                errors[legacy.id].throughQuarter ||= message;
                errors[delivery.id].fromQuarter ||= message;
            }
        }
    }
    const messages = [...new Set(entries.flatMap(entry => Object.values(errors[entry.id])
        .map(error => `${String(entry.name || '').trim() || 'Configuration'}: ${error}`)))];
    return { errors, messages };
}

// Required rows an operational configuration still lacks. `catalog` entries are optional hints:
// {types: {id: type}|null, fields: [{id}]|null}; an id absent from a loaded catalog is reported
// as not found, never silently dropped.
export function missingMappings(entry, catalog = {}) {
    const missing = [];
    if (!(entry.scope.projects || []).length) missing.push('Jira project');
    for (const [name, label] of Object.entries(REQUIRED_FIELDS)) {
        const id = entry.fields?.[name]?.fieldId;
        if (!id) missing.push(label);
        else if (Array.isArray(catalog.fields) && catalog.fields.length && !catalog.fields.some(field => field.id === id)) {
            missing.push(`${label} (not found in Jira)`);
        }
    }
    const labels = hierarchyLabels(entry.model);
    slotsFor(entry.model).forEach((slot, index) => {
        const id = entry.hierarchy?.[slot];
        const label = labels[index];
        if (index < 2) {
            const capturedFilter = entry.model === MODEL_LEGACY && index === 0 && Array.isArray(entry.legacyIssueTypeNames);
            const compatibility = entry.model === MODEL_LEGACY && index === 1 && entry.legacyHierarchyModes?.parent !== 'mapped';
            if (!id && !capturedFilter && !compatibility) missing.push(label);
        }
        if (id && catalog.types && !catalog.types[id]) missing.push(`${label} (${id}: not found in Jira)`);
    });
    return [...new Set(missing)];
}

export const missingSummary = (bundle, catalogFor = () => ({})) => (bundle?.configurations || [])
    .map(entry => ({ entry, missing: missingMappings(entry, catalogFor(entry)) }))
    .filter(item => item.missing.length)
    .map(({ entry, missing }) => `${String(entry.name || '').trim() || 'Unnamed configuration'}: missing ${missing.join(', ')}.`)
    .join(' ');

// --- dirty / first-save edits / requests -----------------------------------

const stable = value => JSON.stringify(value);
export const isEntryDirty = (baseline, draft) => stable(baseline) !== stable(draft);
export const dirtyConfigurationIds = (baselineBundle, draftBundle) => (draftBundle?.configurations || [])
    .filter(entry => isEntryDirty(entryById(baselineBundle, entry.id), entry))
    .map(entry => entry.id);

const isBlank = value => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
const edit = (path, value, { allowBlank = false } = {}) => (isBlank(value) && !allowBlank
    ? { path, clear: true }
    : { path, value: value === undefined || value === null ? '' : value });

// The Legacy values the server may change on first save, derived from baseline->draft differences.
// The server ignores echoed Legacy values, so an edit is emitted only for a real change; a slot whose
// durable mode flips to mapped is an edit even when both ids are null (an explicit clear).
export function deriveLegacyEdits(baselineLegacy, draftLegacy) {
    if (!baselineLegacy || !draftLegacy) return [];
    const edits = [];
    if (baselineLegacy.name !== draftLegacy.name) edits.push(edit('name', draftLegacy.name));
    for (const key of ['fromQuarter', 'throughQuarter']) {
        if (baselineLegacy[key] !== draftLegacy[key]) edits.push(edit(key, draftLegacy[key]));
    }
    if (stable(baselineLegacy.scope.projects) !== stable(draftLegacy.scope.projects)) {
        edits.push(edit('scope.projects', draftLegacy.scope.projects));
    }
    if (baselineLegacy.scope.boardId !== draftLegacy.scope.boardId) edits.push(edit('scope.boardId', draftLegacy.scope.boardId));
    for (const slot of HIERARCHY_SLOTS) {
        const modeSlot = Object.keys(MODE_SLOTS).find(key => MODE_SLOTS[key] === slot);
        const modeRetired = modeSlot && baselineLegacy.legacyHierarchyModes?.[modeSlot] !== 'mapped'
            && draftLegacy.legacyHierarchyModes?.[modeSlot] === 'mapped';
        const filterRetired = slot === 'planningIssueTypeId' && Array.isArray(baselineLegacy.legacyIssueTypeNames)
            && draftLegacy.legacyIssueTypeNames === null;
        if (baselineLegacy.hierarchy[slot] !== draftLegacy.hierarchy[slot] || modeRetired || filterRetired) {
            edits.push(edit(`hierarchy.${slot}`, draftLegacy.hierarchy[slot]));
        }
    }
    for (const name of LEGACY_FIELDS) {
        const before = baselineLegacy.fields[name] || BLANK_FIELD;
        const after = draftLegacy.fields[name] || BLANK_FIELD;
        if (before.fieldId !== after.fieldId) edits.push(edit(`fields.${name}.fieldId`, after.fieldId));
        if (before.fieldName !== after.fieldName) edits.push(edit(`fields.${name}.fieldName`, after.fieldName, { allowBlank: true }));
    }
    return edits;
}

// An explicit project clear is a deliberate gesture (the last chip removed), tracked by the hook; it is
// never inferred from an empty echo.
export const clearedProjectIds = (baselineBundle, draftBundle, explicitClears) => (draftBundle?.configurations || [])
    .filter(entry => explicitClears.has(entry.id)
        && (entryById(baselineBundle, entry.id)?.scope.projects || []).length > 0
        && (entry.scope.projects || []).length === 0)
    .map(entry => entry.id);

export function buildSaveRequest({ baseline, draft, promoted, baseRevision, explicitClears = new Set() }) {
    if (!promoted) {
        return {
            baseRevision,
            workConfigurations: draft,
            legacyEdits: deriveLegacyEdits(entryById(baseline, 'legacy'), entryById(draft, 'legacy')),
        };
    }
    return {
        baseRevision,
        workConfigurations: draft,
        clearProjectsForConfigurationIds: clearedProjectIds(baseline, draft, explicitClears),
    };
}

// Server-owned parts of an entry (ids, models, revisions, promotion, captured display metadata)
// come from `latest`; every editor-owned part stays as the user's draft. Used after a successful
// save and by Keep mine, so a whole-bundle retry never carries stale server-owned fields.
export function adoptServerOwned(draft, latest) {
    if (!draft || !latest) return draft;
    return {
        ...draft,
        promotionRevision: latest.promotionRevision ?? null,
        configurations: draft.configurations.map(entry => {
            const stored = entryById(latest, entry.id);
            if (!stored) return entry;
            const next = { ...entry, revision: stored.revision };
            if (stored.model === MODEL_LEGACY) next.legacyDisplayTypes = stored.legacyDisplayTypes;
            return next;
        }),
    };
}

export const isPromotedBundle = bundle => Number.isInteger(bundle?.promotionRevision) && bundle.promotionRevision > 0;

// Unpromoted workspace seen through a promoted conflict, or any conflict: keep the user's draft,
// retarget it at the latest bundle. Returns {draft, baseline, promoted}.
export function rebaseOntoLatest(draft, latest) {
    return { draft: adoptServerOwned(draft, latest), baseline: cloneBundle(latest), promoted: isPromotedBundle(latest) };
}

// Compatibility-retired failures (400 invalid_work_configurations with configurationId + slot).
export function fieldErrorFromServer(payload) {
    if (!payload || payload.error !== 'invalid_work_configurations' || !payload.configurationId || !payload.slot) return null;
    return {
        configurationId: payload.configurationId,
        slot: payload.slot,
        message: payload.message || 'The compatibility mapping was changed by another editor; choose or clear the Jira type, or reload.',
    };
}

export const normalizeIssueTypes = types => (Array.isArray(types) ? types : []).map(type => ({
    id: String(type?.id ?? ''),
    name: String(type?.name ?? ''),
    hierarchyLevel: Number.isInteger(type?.hierarchyLevel) ? type.hierarchyLevel : null,
    subtask: Boolean(type?.subtask),
    iconUrl: typeof type?.iconUrl === 'string' ? type.iconUrl : '',
    projectIds: Array.isArray(type?.projectIds) ? type.projectIds.map(String) : [],
})).filter(type => type.id && type.name);

// Hierarchy picker state for one slot. `catalogState`: loading | error | unscoped | ready.
export function describeHierarchyRow({ entry, slot, index, types, catalogState }) {
    const labels = hierarchyLabels(entry.model);
    const offset = hierarchyLevelOffset(entry.model);
    const id = entry.hierarchy?.[slot] || null;
    const ready = catalogState === 'ready';
    const options = ready
        ? types.filter(type => Number.isInteger(type.hierarchyLevel) && type.hierarchyLevel === index + offset && !type.subtask)
        : [];
    const duplicateNames = new Set();
    const seen = new Set();
    for (const type of types) {
        if (seen.has(type.name)) duplicateNames.add(type.name);
        seen.add(type.name);
    }
    const display = type => (duplicateNames.has(type.name) ? { ...type, name: `${type.name} (${type.id})` } : type);
    const found = id ? types.find(type => type.id === id) : null;
    let selected = null;
    let status = 'empty';
    if (id) {
        if (found && Number.isInteger(found.hierarchyLevel)) { selected = display(found); status = 'resolved'; }
        else if (found) { selected = display(found); status = 'unknown-level'; }
        else if (!ready) {
            const reason = catalogState === 'loading' ? 'Loading Jira type' : catalogState === 'error' ? 'Jira catalog unavailable' : 'Jira type not loaded';
            selected = { id, name: `${id} · ${reason}` };
            status = catalogState;
        } else { selected = { id, name: `${id} · Not found in Jira` }; status = 'unresolved'; }
    }
    return { id, label: labels[index], options: options.map(display), selected, status, required: index < 2 };
}

// Identity of the saved entry a scoped metadata read answers for. The key (not only the id) retires a
// cached answer when the saved revision, selected projects or the mapped parent authority change, so
// the same Board and projects under a new parent-type mapping never reuse an old catalog.
export function catalogScopeFor(entry, quarter = '') {
    if (!entry?.id) return null;
    const projects = (entry.scope?.projects || []).map(project => project.key).sort().join(',');
    const mode = entry.model === MODEL_LEGACY ? (entry.legacyHierarchyModes?.parent || 'compatibility') : 'mapped';
    return {
        configurationId: entry.id,
        configurationRevision: entry.revision ?? 0,
        digest: `${projects}|${entry.scope?.boardId || ''}`,
        parentAuthority: `${mode}:${entry.hierarchy?.parentIssueTypeId || ''}`,
        quarter,
    };
}
