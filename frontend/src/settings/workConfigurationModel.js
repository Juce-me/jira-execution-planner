// Pure draft/patch/validation/save-request logic for the quarterly Project config editor.
// The server owns ids, models, revisions, promotion and captured compatibility metadata
// (backend/services/work_structure.py); this module only edits the fields the editor owns and
// derives the exact request bodies. No React, no I/O.

import { canonicalQuarter } from '../workStructure/configurationContext.js';

export const MODEL_LEGACY = 'legacy';
export const MODEL_RND = 'rnd_2027';
export const DELIVERY_PROJECT_LIMIT_MESSAGE = 'DELIVERY uses one Jira project';

export const HIERARCHY_SLOTS = ['planningIssueTypeId', 'parentIssueTypeId', 'ancestorIssueTypeId', 'optionalAncestorIssueTypeId'];
export const MODE_SLOTS = { parent: 'parentIssueTypeId', ancestor: 'ancestorIssueTypeId' };
export const LEGACY_FIELDS = ['sprint', 'storyPoints', 'parentName', 'team', 'projectTrack', 'deliveryOwner'];
export const RND_FIELDS = [...LEGACY_FIELDS, 'allocation'];
export const REQUIRED_FIELDS = { sprint: 'Sprint', storyPoints: 'Story Points', team: 'Team' };
// DELIVERY mappings that default to Legacy's: `shared` keeps no value and reads Legacy's field; `own` is DELIVERY's
// own mapping, where blank is a deliberate clear (`SHARED_FIELD_NAMES` in backend/services/work_structure.py).
export const SHARED_FIELDS = ['sprint', 'storyPoints', 'team'];
// Team is one field for every configuration (`ALWAYS_SHARED_FIELD_NAMES`): DELIVERY never maps its own.
export const ALWAYS_SHARED_FIELDS = ['team'];
export const FIELD_MODE_SHARED = 'shared';
export const FIELD_MODE_OWN = 'own';
// A mapping without a mode (saved before modes existed) reads as the server normalizes it: blank shares, set is own.
export const isSharedField = (entry, name) => entry?.model === MODEL_RND && SHARED_FIELDS.includes(name)
    && (ALWAYS_SHARED_FIELDS.includes(name) || entry.fields?.[name]?.mode === FIELD_MODE_SHARED || (entry.fields?.[name]?.mode === undefined && !entry.fields?.[name]?.fieldId));
export const BLANK_FIELD = Object.freeze({ fieldId: '', fieldName: '' });

const QUARTER = /^[0-9]{4}Q[1-4]$/;
export const QUARTER_MESSAGE = 'Choose a Sprint value in the form YYYYQ1–YYYYQ4 with a calendar year from 0001 to 9999.';

export const isValidQuarter = value => value === null
    || (typeof value === 'string' && QUARTER.test(value) && Number(value.slice(0, 4)) >= 1);
export const quarterIndex = value => Number(value.slice(0, 4)) * 4 + Number(value.slice(-1)) - 1;
const SPRINT_STATE_LABEL = { active: 'active', closed: 'closed', future: 'future' };

// Picker options for the Scope boundaries: one per observed Sprint value (the stored value string is the
// option id). A value that is not canonical `YYYYQn` stays listed but disabled, so it can never become a boundary.
export function sprintValueOptions(sprintValues) {
    return ((sprintValues && sprintValues.values) || []).map(item => ({
        id: item.value,
        name: item.value,
        disabled: !item.canonical,
        detail: [
            item.canonical ? null : 'not a valid boundary',
            SPRINT_STATE_LABEL[item.state] || null,
            Array.isArray(item.sprintIds) && item.sprintIds.length ? `Jira id ${item.sprintIds.join(', ')}` : null,
        ].filter(Boolean).join(' · ') || item.value,
    }));
}

// The way out when the Sprint list is missing, still loading or lacks the wanted value: typed text that is
// exactly a canonical boundary (strict `YYYYQ1`-`YYYYQ4`, year 0001-9999) and not already an option becomes
// one extra option. Anything else offers nothing.
export function typedSprintOption(query, options = []) {
    const value = typeof query === 'string' ? query.trim() : '';
    if (!canonicalQuarter(value) || options.some(option => option.id === value)) return null;
    return { id: value, name: `Use ${value}`, detail: 'not in the Sprint list' };
}

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
                // Any edit makes a DELIVERY mapping its own (a removal is a deliberate clear); only the explicit
                // "Same as Legacy" action, which sends `mode: shared` and no value, shares it again.
                if (entry.model === MODEL_RND && SHARED_FIELDS.includes(name)) {
                    const shared = mapping?.mode === FIELD_MODE_SHARED || ALWAYS_SHARED_FIELDS.includes(name);
                    next.fields[name] = shared ? { fieldId: '', fieldName: '', mode: FIELD_MODE_SHARED } : { ...next.fields[name], mode: FIELD_MODE_OWN };
                }
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
            errors[entry.id].throughQuarter = 'Through Sprint must not be earlier than From Sprint.';
        }
        if (entry.model === MODEL_RND && (entry.scope.projects || []).length > 1) {
            errors[entry.id].projects = DELIVERY_PROJECT_LIMIT_MESSAGE;
        }
    }
    const legacy = entries.find(entry => entry.model === MODEL_LEGACY);
    const delivery = entries.find(entry => entry.model === MODEL_RND);
    if (legacy && delivery && entries.every(entry => !errors[entry.id].fromQuarter && !errors[entry.id].throughQuarter)) {
        if (legacy.fromQuarter) errors[legacy.id].fromQuarter = 'The first configuration has no From Sprint.';
        if (delivery.throughQuarter) errors[delivery.id].throughQuarter = 'The last configuration has no Through Sprint.';
        if (!legacy.throughQuarter || !delivery.fromQuarter) {
            if (!legacy.throughQuarter) errors[legacy.id].throughQuarter = 'Choose a Through Sprint.';
            if (!delivery.fromQuarter) errors[delivery.id].fromQuarter = 'Choose a From Sprint.';
        } else {
            const gap = quarterIndex(delivery.fromQuarter) - quarterIndex(legacy.throughQuarter);
            const message = gap <= 0 ? 'Through and From Sprint overlap.' : gap > 1 ? 'Through and From Sprint leave a gap; they must meet.' : '';
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
// The Board a blank entry runs with: the nearest other configuration that has one, as the server's `inherit_board`
// resolves it. Display only; the entry keeps its blank Board (and digest) until an admin chooses one, and its own Board wins.
export function inheritedBoard(entries = [], entryId) {
    const list = Array.isArray(entries) ? entries : [];
    const position = Math.max(0, list.findIndex(item => item?.id === entryId));
    if (list[position]?.scope?.boardId) return null;
    const donors = list.map((item, index) => ({ item, distance: Math.abs(index - position) }))
        .filter(({ item }) => item?.id !== entryId && item?.scope?.boardId);
    if (!donors.length) return null;
    const { item } = donors.reduce((best, next) => (next.distance < best.distance ? next : best));
    return { boardId: String(item.scope.boardId), fromId: item.id, fromName: item.name || '' };
}

// What an entry runs with, as the server's `effective_entry` resolves it: shared mappings from Legacy and a blank
// Board from the nearest configuration. Display and completeness only; the draft keeps its own values.
export function effectiveEntry(entries = [], entry) {
    const list = Array.isArray(entries) ? entries : [];
    const legacy = list.find(item => item?.model === MODEL_LEGACY);
    const shared = SHARED_FIELDS.filter(name => isSharedField(entry, name));
    const board = inheritedBoard(list, entry.id);
    if (!shared.length && !board) return entry;
    const fields = { ...entry.fields };
    shared.forEach((name) => {
        const source = legacy?.fields?.[name] || BLANK_FIELD;
        fields[name] = { fieldId: source.fieldId || '', fieldName: source.fieldName || '', mode: FIELD_MODE_SHARED };
    });
    return { ...entry, fields, scope: board ? { ...entry.scope, boardId: board.boardId } : entry.scope };
}

// {types: {id: type}|null, fields: [{id}]|null}; an id absent from a loaded catalog is reported
// as not found, never silently dropped. With `entries`, a shared mapping or an inherited Board counts as set.
export function missingMappings(draftEntry, catalog = {}, entries = null) {
    const entry = entries ? effectiveEntry(entries, draftEntry) : draftEntry;
    const missing = [];
    if (!(entry.scope.projects || []).length) missing.push('Jira project');
    if (!entry.scope.boardId) missing.push('Board');
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

// Which nested tabs still need the user: the first-save blockers plus every required row that is empty.
// Pure and catalog-free, so the markers react to the draft only.
export function incompleteTabs(entry, errors = {}, catalog = {}, entries = null) {
    const missing = missingMappings(entry, catalog, entries);
    const scopeErrors = ['name', 'fromQuarter', 'throughQuarter', 'projects'].some(key => errors[key]);
    const isSprint = item => item === 'Board' || item === 'Sprint' || item.startsWith('Sprint (');
    return {
        scope: scopeErrors || missing.includes('Jira project'),
        source: missing.some(isSprint),
        mapping: missing.some(item => item !== 'Jira project' && !isSprint(item)),
    };
}

export const missingSummary = (bundle, catalogFor = () => ({})) => (bundle?.configurations || [])
    .map(entry => ({ entry, missing: missingMappings(entry, catalogFor(entry), bundle.configurations) }))
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

// Saved configurations whose configured Jira type ids lack a captured name in their app-config summary
// `roleTypes`, or whose capture no longer matches the loaded catalog (a Jira rename or level change). A Save
// of the unchanged bundle lets the server capture them (`capture_role_types`). Only a ready catalog and a known
// summary are judged, so a failed or loading read never asks for a save. Legacy compatibility slots and the
// captured name filter keep fixed names (`entry_role_types`) and are never compared.
const ROLE_TYPE_SLOTS = { planning: 'planningIssueTypeId', parent: 'parentIssueTypeId', ancestor: 'ancestorIssueTypeId', optionalAncestor: 'optionalAncestorIssueTypeId' };
export function typeNamesNeedingSave({ entries = [], summaries = [], catalogFor = () => null }) {
    return entries.filter(entry => {
        const catalog = catalogFor(entry.id);
        const summary = (summaries || []).find(item => item?.id === entry.id);
        if (catalog?.state !== 'ready' || !summary) return false;
        return Object.entries(ROLE_TYPE_SLOTS).some(([slot, key]) => {
            const id = entry.hierarchy?.[key];
            if (!id) return false;
            if (entry.model === MODEL_LEGACY && (slot === 'planning'
                ? Array.isArray(entry.legacyIssueTypeNames) : entry.legacyHierarchyModes?.[slot] === 'compatibility')) return false;
            const type = catalog.types.find(item => item.id === id);
            const name = String(type?.name || '').trim();
            if (!name || name.length > 255) return false;
            const captured = summary.roleTypes?.[slot];
            return !captured || captured.id !== id || captured.name !== name || captured.hierarchyLevel !== type.hierarchyLevel;
        });
    }).map(entry => entry.id);
}

// What a Discard acknowledges: the listed configurations with their summary captures and the catalog types their
// slots name. A new capture, a Jira rename or another listed configuration changes it, so the request returns.
export function typeNamesSignature({ ids = [], entries = [], summaries = [], catalogFor = () => null }) {
    if (!ids.length) return '';
    return JSON.stringify(ids.map(id => {
        const entry = (entries || []).find(item => item.id === id);
        const types = catalogFor(id)?.types || [];
        const configured = Object.values(ROLE_TYPE_SLOTS).map(key => types.find(type => type.id === entry?.hierarchy?.[key]) || null)
            .map(type => (type ? [type.id, type.name, type.hierarchyLevel] : null));
        return [id, (summaries || []).find(item => item?.id === id)?.roleTypes ?? null, configured];
    }));
}

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
    projectKeys: Array.isArray(type?.projectKeys) ? type.projectKeys.map(String) : [],
})).filter(type => type.id && type.name);

// Hierarchy picker state for one slot. `catalogState`: loading | error | unscoped | ready.
export function describeHierarchyRow({ entry, slot, index, types, catalogState }) {
    const labels = hierarchyLabels(entry.model);
    const offset = hierarchyLevelOffset(entry.model);
    const id = entry.hierarchy?.[slot] || null;
    const ready = catalogState === 'ready';
    // Team-managed projects each own a same-named type with its own id, so only types the selected
    // projects actually use are offered; `projectIds` is filled by the scoped catalog read.
    const scoped = (entry.scope?.projects || []).length > 0;
    const inScope = type => !scoped || type.projectIds.length > 0;
    const options = ready
        ? types.filter(type => Number.isInteger(type.hierarchyLevel) && type.hierarchyLevel === index + offset && !type.subtask && inScope(type))
        : [];
    const duplicateNames = new Set();
    const seen = new Set();
    for (const type of types) {
        if (seen.has(type.name)) duplicateNames.add(type.name);
        seen.add(type.name);
    }
    // Same-named types (team-managed projects each own one) are told apart by their project; the id is shown once,
    // by the global Jira IDs setting, never repeated in the name.
    const display = type => (duplicateNames.has(type.name) && type.projectKeys.length ? { ...type, name: `${type.name} \u00b7 ${type.projectKeys.join(', ')}` } : type);
    const outsideScope = type => ready && !inScope(type);
    const chip = type => {
        const shown = display(type);
        return outsideScope(type) ? { ...shown, name: `${shown.name} · not used by the selected project` } : shown;
    };
    const found = id ? types.find(type => type.id === id) : null;
    let selected = null;
    let status = 'empty';
    if (id) {
        if (found && Number.isInteger(found.hierarchyLevel)) { selected = chip(found); status = 'resolved'; }
        else if (found) { selected = display(found); status = 'unknown-level'; }
        else if (!ready) {
            const reason = catalogState === 'loading' ? 'Loading Jira type' : catalogState === 'error' ? 'Jira catalog unavailable' : 'Jira type not loaded';
            selected = { id, name: `${id} · ${reason}` };
            status = catalogState;
        } else { selected = { id, name: `${id} · Not found in Jira` }; status = 'unresolved'; }
    }
    return { id, label: labels[index], options: options, selected, status, required: index < 2 };
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

const READ_FAILURES = {
    jira_unavailable: 'Jira could not be reached when this source was last read; refresh to retry.',
    catalog_incomplete: 'The last read of this source was incomplete; refresh to retry.',
};

// The concrete reason a source holds no Sprint for the quarter, from its numbers-only read diagnostics; null when unknown.
export function sourceCause(diagnostics, quarter) {
    if (!diagnostics) return null;
    const { code, scannedIssueCount, issuesWithSprintValueCount, observedSprintCount } = diagnostics;
    if (code) return READ_FAILURES[code] || 'The last read of this source failed; refresh to retry.';
    if (scannedIssueCount === 0) return 'No issues matched this configuration\'s projects.';
    if (scannedIssueCount > 0 && issuesWithSprintValueCount === 0) {
        return `${scannedIssueCount} issues were read and none has a Sprint value; check the Sprint field.`;
    }
    if (observedSprintCount > 0) return `${observedSprintCount} Sprints were found, none for ${quarter}.`;
    return null;
}

// A saved source can be read from Jira: a Board, or Jira projects with a mapped Sprint field.
export const savedSourceReady = entry => Boolean(entry && (entry.scope?.boardId
    || ((entry.scope?.projects || []).length > 0 && entry.fields?.sprint?.fieldId)));

export const sprintRefreshLine = entry => `Save ${entry?.name || 'this configuration'}'s project and Sprint field first, or type the Sprint value (for example 2027Q1).`;
