import * as React from 'react';
import { fetchSprintReview, readSprintReviewValues, saveSprintReview, createPlanningOperationId, freezePlanningSavePayload, fetchPlanningSaveOperation } from '../api/sprintReviewApi.js';
import { createPlanningInclusionDraft } from './planningInclusionDraft.js';
import { reviewCellKey, validateReviewValue, parseReviewNumber, REVIEW_LIMIT_MESSAGES } from './planningReviewTableModel.js';
import { REVIEW_ROLES, toNativeChange, toNativeKind, toRoleSchema } from './planningReviewKinds.js';
import { WORK_WRITE_ERROR_MESSAGES } from '../workStructure/writeErrors.js';

export function applyReviewSchemaChanges(columns, changes) {
    let result = columns.map(column => ({ ...column }));
    for (const change of changes) {
        if (change.action === 'add') result.push({ ...change.column });
        else if (change.action === 'reorder') {
            const order = new Map(change.columnIds.map((id, index) => [id, index]));
            result = result.map(column => column.rowKind === change.rowKind && order.has(column.id) ? { ...column, order: order.get(column.id) } : column);
        } else result = result.map(column => column.id !== change.columnId ? column : {
            ...column,
            ...(change.action === 'rename' ? { label: change.label } : {}),
            ...(change.action === 'archive' ? { archived: change.archived } : {}),
            ...(change.action === 'aggregation' ? { aggregation: change.aggregation } : {}),
        });
    }
    return result;
}

export function applyReviewLayoutChanges(layouts = {}, changes = []) {
    const result = { ...layouts };
    for (const change of changes) if (change.action === 'layout') result[change.rowKind] = { order: [...change.order], hidden: [...change.hidden] };
    return result;
}

// A stored review namespace without a resolved quarter ordinal cannot save a layout (the server answers 400 review_quarter_unresolved).
const LAYOUT_BLOCKED_MESSAGE = WORK_WRITE_ERROR_MESSAGES.review_quarter_unresolved;
const GROUP_BLOCKED_MESSAGES = { review_group_unknown: 'This Department group is no longer configured.', review_view_limit: 'This group has reached its limit of saved Sprint views.' };
const responseView = data => ({ viewRevision: Number.isInteger(data.viewRevision) ? data.viewRevision : 0, inheritedFrom: data.inheritedFrom == null ? null : data.inheritedFrom });

export function createPlanningSprintReviewController({ backendUrl = '', fetchSchema = fetchSprintReview, readValues = readSprintReviewValues, saveReview = saveSprintReview, readOperation = fetchPlanningSaveOperation, onReviewAction } = {}) {
    let state = { sprintId: '', groupId: '', contextKey: '', workModel: 'legacy', layoutBlocked: false, savedViewRevision: 0, currentViewRevision: 0, savedInheritedFrom: null, currentInheritedFrom: null, groupBlocked: false, forceLoading: false, columns: [], cells: {}, schemaRevision: 0, schemaChanges: [], drafts: {}, capabilities: { canRead: false, canSave: false }, dirty: false, loading: false, saving: false, error: '', conflict: null, unconfirmed: false, progress: null, pendingScopeChange: false };
    let currentRows = [], active = false, generation = 0, pendingScope = null, disposed = false;
    let currentCandidates = [], planScope = null, inclusion = createPlanningInclusionDraft(), pendingOperation = null;
    let currentPlanEntries = [], planProjectionSignature = '';
    const shared = () => state.planEnabled === true;
    const candidateIds = () => [...new Set(currentCandidates.filter(row => !row.synthetic && (!row.rowKind || row.rowKind === 'story') && /^[1-9][0-9]*$/.test(String(row.issueId || row.id || ''))).map(row => String(row.issueId || row.id)))];
    const sameScope = value => value && planScope && ['workspaceId', 'groupId', 'sprintId', 'namespaceId'].every(key => value[key] === planScope[key]);
    // The model selects the native row kinds the server stores under; everything above this boundary uses the table roles.
    const fromServer = data => toRoleSchema(state.workModel, data);
    let loadedIds = new Set();
    let loadQueued = null, runningRead = null, deferredRead = false, writeEpoch = 0;
    const blockedDuringOwnRead = () => Boolean(state.dirty || state.saving || state.conflict || state.unconfirmed || state.pendingScopeChange);
    const settleQueued = status => { loadQueued?.waiters.splice(0).forEach(waiter => waiter.resolve({ status })); loadQueued = null; };
    let lifetime = new AbortController();
    const listeners = new Set();
    const emit = patch => {
        state = { ...state, ...patch };
        // Reads publish staged data; the live guard owns its promise and must not be
        // closed or resurrected by the older pendingScopeChange in that snapshot.
        state.pendingScopeChange = Boolean(pendingScope);
        state.dirty = state.schemaChanges.length > 0 || Object.keys(state.drafts).length > 0 || shared() && inclusion.dirty;
        if (shared()) {
            const authorized = new Set(currentPlanEntries.map(entry => entry.issueId));
            state.planEntries = [...inclusion.effectiveEntries.values()].filter(entry => authorized.has(entry.issueId));
            state.canUndoInclusion = inclusion.canUndo && !state.saving && !state.unconfirmed;
            state.pendingOperation = pendingOperation;
            const reviewCapabilities = state.reviewCapabilities || state.capabilities;
            state.capabilities = { ...reviewCapabilities, canSave: Boolean(reviewCapabilities.canSave && state.planReady && state.planCapabilities?.canSave) };
        }
        state.layouts = applyReviewLayoutChanges(state.savedLayouts, state.schemaChanges);
        state.viewRevision = state.savedViewRevision; state.inheritedFrom = state.savedInheritedFrom;
        state.columns = applyReviewSchemaChanges(state.savedColumns || [], state.schemaChanges);
        state.cells = { ...(state.savedCells || {}), ...Object.fromEntries(Object.entries(state.drafts).filter(([, cell]) => cell.valid !== false)) };
        listeners.forEach(listener => listener());
    };
    const reset = (sprintId, contextKey, groupId, workModel = state.workModel) => {
        generation += 1;
        pendingScope?.resolve(false); pendingScope = null; settleQueued('ignored'); runningRead = null;
        lifetime.abort(); lifetime = new AbortController(); loadedIds = new Set(); deferredRead = false;
        inclusion = createPlanningInclusionDraft(); pendingOperation = null; currentPlanEntries = []; planProjectionSignature = '';
        state = { ...state, workModel, layoutBlocked: false, sprintId: String(sprintId || ''), groupId, contextKey, savedColumns: [], savedLayouts: {}, currentLayouts: {}, savedViewRevision: 0, currentViewRevision: 0, savedInheritedFrom: null, currentInheritedFrom: null, groupBlocked: false, forceLoading: false, savedCells: {}, schemaRevision: 0, schemaChanges: [], drafts: {}, columns: [], cells: {}, capabilities: { canRead: false, canSave: false }, loading: false, saving: false, discarding: false, error: '', conflict: null, unconfirmed: false, progress: null, pendingScopeChange: false, schemaLoaded: false, currentSchemaRevision: 0, currentColumns: [], unavailableIssueIds: [] };
        emit({ planEnabled: false, planReady: false, plan: null, currentPlan: null, scopeProof: null, planCapabilities: { canRead: false, canSave: false }, planEntries: [], pendingOperation: null, confirmedOperationId: null, reviewCapabilities: null });
    };
    async function readSharedProjection(initialSchema, signal, current, extraPlanIds = []) {
        let metadata = initialSchema;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                if (attempt) metadata = fromServer(await fetchSchema(backendUrl, state.sprintId, { signal, groupId: state.groupId }));
                if (!current()) return null;
                if (!metadata.plan || !Number.isSafeInteger(metadata.plan.revision) || metadata.plan.revision < 0 || typeof metadata.plan.exists !== 'boolean' || typeof metadata.scopeProof !== 'string' || !metadata.planCapabilities?.canRead) throw new Error('Shared plan is unavailable.');
                const candidates = candidateIds(), ids = [...new Set([...candidates, ...extraPlanIds])], entries = [], cells = [], unavailable = new Set();
                const batches = [];
                for (let offset = 0; offset < ids.length; offset += 500) batches.push(ids.slice(offset, offset + 500));
                for (let index = 0; index < batches.length; index++) {
                    if (!current()) return null;
                    const issueIds = batches[index];
                    let data;
                    try { data = fromServer(await readValues(backendUrl, state.sprintId, { groupId: state.groupId, rowKind: toNativeKind(state.workModel, 'story'), issueIds, includePlan: true, expectedPlanRevision: metadata.plan.revision, expectedScopeProof: metadata.scopeProof }, { signal })); }
                    catch (error) {
                        if (error.status !== 413 || issueIds.length < 2) throw error;
                        const middle = Math.ceil(issueIds.length / 2);
                        batches.splice(index, 1, issueIds.slice(0, middle), issueIds.slice(middle));
                        index--;
                        continue;
                    }
                    if (!current()) return null;
                    if (data.planRevision !== metadata.plan.revision || data.scopeProof !== metadata.scopeProof) throw Object.assign(new Error('Shared plan changed.'), { code: 'plan_projection_changed' });
                    if (!Array.isArray(data.planEntries) || !Array.isArray(data.unavailableIssueIds || [])) throw new Error('Incomplete shared plan.');
                    const blocked = new Set(data.unavailableIssueIds || []), seen = new Set();
                    for (const entry of data.planEntries) {
                        if (!issueIds.includes(entry.issueId) || blocked.has(entry.issueId) || seen.has(entry.issueId)) throw new Error('Invalid shared plan projection.');
                        seen.add(entry.issueId); entries.push(entry);
                    }
                    if (issueIds.some(id => !blocked.has(id) && !seen.has(id)) || [...blocked].some(id => !issueIds.includes(id))) throw new Error('Incomplete shared plan projection.');
                    blocked.forEach(id => unavailable.add(id));
                    cells.push(...(data.cells || []).filter(cell => issueIds.includes(cell.issueId) && !blocked.has(cell.issueId)));
                }
                // Validate the complete response before publishing any chunk or changing the live draft.
                createPlanningInclusionDraft({ entries, planExists: metadata.plan.exists });
                return { metadata, entries, cells, unavailableIssueIds: [...unavailable], requestedIds: ids, signature: candidates.sort().join('|') };
            } catch (error) {
                if (error.code !== 'plan_projection_changed' || attempt === 2) throw error;
            }
        }
        return null;
    }
    function confirmColumns(data, operation) {
        if (!Array.isArray(data.columns)) return false;
        if (operation.schemaChanges.some(change => change.action !== 'layout') && data.schemaRevision !== operation.payload.baseSchemaRevision + 1) return false;
        const expected = operation.expectedColumns;
        for (const change of operation.schemaChanges) {
            if (change.action === 'layout') {
                const layout = data.layouts?.[change.rowKind];
                if (JSON.stringify(layout?.order) !== JSON.stringify(change.order) || JSON.stringify(layout?.hidden) !== JSON.stringify(change.hidden)) return false;
            } else if (change.action === 'reorder') {
                const order = data.columns.filter(column => column.rowKind === change.rowKind && change.columnIds.includes(column.id)).sort((a, b) => a.order - b.order).map(column => column.id);
                const finalOrder = expected.filter(column => column.rowKind === change.rowKind && change.columnIds.includes(column.id)).sort((a, b) => a.order - b.order).map(column => column.id);
                if (JSON.stringify(order) !== JSON.stringify(finalOrder)) return false;
                if (data.columns.some(column => change.columnIds.includes(column.id) && column.order !== expected.find(target => target.id === column.id)?.order)) return false;
            } else {
                const id = change.action === 'add' ? change.column.id : change.columnId;
                const target = expected.find(column => column.id === id), matches = data.columns.filter(column => column.id === id);
                if (!target || matches.length !== 1) return false;
                const keys = change.action === 'add' ? ['id', 'rowKind', 'label', 'type', 'aggregation', 'archived', 'after', 'order'] : [{ rename: 'label', archive: 'archived', aggregation: 'aggregation' }[change.action]];
                if (keys.some(key => matches[0][key] !== target[key])) return false;
            }
        }
        return true;
    }
    async function load({ force = false, options = {} } = {}) {
        const automatic = options.automatic === true;
        const outcome = status => automatic ? { status } : status === 'ok';
        if (!active || !state.sprintId || !state.groupId || !state.contextKey || disposed || state.saving || (automatic && (blockedDuringOwnRead() || options.signal?.aborted || options.shouldApply?.() === false))) return outcome('ignored');
        if (runningRead) {
            loadQueued ||= { force: false, options: {}, waiters: [], manual: false };
            loadQueued.force ||= force;
            if (!automatic && (force || loadQueued.options.signal?.aborted)) {
                loadQueued.manual = true; loadQueued.options = {};
                loadQueued.waiters.splice(0).forEach(waiter => waiter.resolve({ status: 'ignored' }));
            } else if (automatic && !loadQueued.manual) loadQueued.options = options;
            if (!automatic) return false;
            if (loadQueued.manual) return outcome('ignored');
            const queued = loadQueued;
            return new Promise((resolve, reject) => {
                const abort = () => waiter.resolve({ status: 'ignored' });
                const finish = callback => result => { options.signal?.removeEventListener('abort', abort); const index = queued.waiters.indexOf(waiter); if (index >= 0) queued.waiters.splice(index, 1); callback(result); };
                const waiter = { resolve: finish(resolve), reject: finish(reject) };
                queued.waiters.push(waiter); options.signal?.addEventListener('abort', abort, { once: true });
                if (options.signal?.aborted) abort();
            });
        }
        const thisGeneration = generation, thisEpoch = writeEpoch;
        const { sprintId, groupId } = state;
        const restore = !automatic && force ? { savedCells: state.savedCells, unavailableIssueIds: state.unavailableIssueIds, loadedIds } : null;
        const read = {}; runningRead = read;
        const controller = new AbortController();
        const lifetimeSignal = lifetime.signal;
        const abort = () => controller.abort();
        lifetimeSignal.addEventListener('abort', abort, { once: true });
        options.signal?.addEventListener('abort', abort, { once: true });
        const signal = controller.signal;
        let staged = { ...state }, stagedIds = new Set(loadedIds), projection = null, stageShared = shared();
        const current = () => generation === thisGeneration && !disposed && !signal.aborted && (!automatic || thisEpoch === writeEpoch && (!blockedDuringOwnRead() && options.shouldApply?.() !== false));
        const publish = patch => { if (automatic || stageShared) staged = { ...staged, ...patch }; else { emit(patch); staged = state; } };
        if (!automatic) emit({ loading: true, forceLoading: force, error: '', progress: { completed: 0, total: 0 } });
        try {
            if (force || !state.schemaLoaded || shared() && planProjectionSignature !== candidateIds().sort().join('|')) {
                const schema = fromServer(await fetchSchema(backendUrl, sprintId, { signal, groupId }));
                if (!current()) return outcome('ignored');
                stageShared = Object.hasOwn(schema, 'plan');
                if (stageShared) {
                    publish({ planEnabled: true, reviewCapabilities: schema.capabilities || {}, planCapabilities: schema.planCapabilities || { canRead: false, canSave: false } });
                    if (schema.planCapabilities?.canRead) projection = await readSharedProjection(schema, signal, current, options.extraPlanIds);
                    if (projection) {
                        const latest = projection.metadata;
                        Object.assign(schema, latest);
                        publish({ currentPlan: latest.plan, plan: state.dirty && state.plan ? state.plan : latest.plan, scopeProof: state.dirty && state.scopeProof ? state.scopeProof : latest.scopeProof, currentScopeProof: latest.scopeProof, planReady: true, planStale: false, planCapabilities: latest.planCapabilities });
                    } else publish({ planReady: false });
                }
                const view = responseView(schema);
                // Refresh retains every draft and its original revision until explicit recovery; only a
                // pending column action conflicts on schemaRevision and only a pending layout on viewRevision.
                const schemaConflict = state.dirty && state.schemaChanges.some(change => change.action !== 'layout') && schema.schemaRevision !== state.schemaRevision;
                const viewConflict = state.dirty && state.schemaChanges.some(change => change.action === 'layout') && view.viewRevision !== state.savedViewRevision;
                publish({ savedColumns: state.dirty ? state.savedColumns : schema.columns || [], currentColumns: schema.columns || [], savedLayouts: state.dirty ? state.savedLayouts : schema.layouts || {}, currentLayouts: schema.layouts || {}, schemaRevision: state.dirty ? state.schemaRevision : schema.schemaRevision, currentSchemaRevision: schema.schemaRevision, savedViewRevision: state.dirty ? state.savedViewRevision : view.viewRevision, currentViewRevision: view.viewRevision, savedInheritedFrom: state.dirty ? state.savedInheritedFrom : view.inheritedFrom, currentInheritedFrom: view.inheritedFrom, capabilities: schema.capabilities || {}, layoutBlocked: schema.configurationId != null && schema.quarterOrdinal == null, schemaLoaded: true, ...(schemaConflict || viewConflict ? { conflict: { schemaConflict, viewConflict }, error: schemaConflict ? 'The shared columns changed. Your draft is preserved.' : 'The shared review changed. Your draft is preserved.' } : {}) });
            }
            if (!staged.capabilities.canRead) {
                if (stageShared && current()) {
                    // Capability denial must publish even on a manual refresh. Retain the mounted
                    // draft and its bases, but never keep the prior read/save authority enabled.
                    emit({ planEnabled: true, planReady: false, reviewCapabilities: staged.reviewCapabilities,
                        capabilities: staged.capabilities, planCapabilities: staged.planCapabilities, groupBlocked: false });
                } else if (automatic && current()) { loadedIds = stagedIds; emit({ ...staged, groupBlocked: false }); }
                else if (!automatic) emit({ groupBlocked: false });
                return outcome('ok');
            }
            const requested = [...currentRows.filter(row => !row.synthetic && row.issueId && REVIEW_ROLES.includes(row.rowKind)), ...(force ? Object.values(state.drafts).map(cell => ({ issueId: cell.issueId, rowKind: cell.rowKind })) : []), ...(options.recoveryRows || [])];
            const batches = [];
            for (const rowKind of REVIEW_ROLES) {
                if (stageShared && rowKind === 'story') continue;
                const ids = [...new Set(requested.filter(row => row.rowKind === rowKind).map(row => row.issueId))].filter(id => force || !stagedIds.has(`${rowKind}:${id}`));
                for (let offset = 0; offset < ids.length; offset += 500) batches.push({ rowKind, issueIds: ids.slice(offset, offset + 500) });
            }
            const total = batches.reduce((sum, batch) => sum + batch.issueIds.length, 0);
            let completed = 0;
            if (!automatic) emit({ progress: { completed, total } });
            for (const batch of batches) {
                if (!current()) return outcome('ignored');
                let data;
                try { data = fromServer(await readValues(backendUrl, sprintId, { groupId, ...batch, rowKind: toNativeKind(state.workModel, batch.rowKind) }, { signal })); }
                catch (error) {
                    if (error.status !== 413 || batch.issueIds.length < 2) throw error;
                    const middle = Math.ceil(batch.issueIds.length / 2);
                    const index = batches.indexOf(batch);
                    batches.splice(index + 1, 0, { ...batch, issueIds: batch.issueIds.slice(0, middle) }, { ...batch, issueIds: batch.issueIds.slice(middle) });
                    continue;
                }
                if (!current()) return outcome('ignored');
                const savedCells = { ...staged.savedCells };
                const unavailable = new Set(data.unavailableIssueIds || []);
                if (force) {
                    for (const [key, cell] of Object.entries(savedCells)) {
                        if (cell.rowKind === batch.rowKind && batch.issueIds.includes(cell.issueId)) delete savedCells[key];
                    }
                }
                for (const cell of data.cells || []) if (!automatic || (cell.rowKind === batch.rowKind && batch.issueIds.includes(cell.issueId) && !unavailable.has(cell.issueId))) savedCells[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)] = cell;
                batch.issueIds.forEach(id => { if (unavailable.has(id)) stagedIds.delete(`${batch.rowKind}:${id}`); else stagedIds.add(`${batch.rowKind}:${id}`); });
                completed += batch.issueIds.length;
                publish({ savedCells, ...(!automatic ? { progress: { completed, total } } : {}), unavailableIssueIds: [...new Set([...(staged.unavailableIssueIds || []).filter(id => !batch.issueIds.includes(id)), ...unavailable])] });
                if (!automatic) loadedIds = stagedIds;
            }
            if (!current()) return outcome('ignored');
            if (projection) {
                const savedCells = Object.fromEntries(Object.entries(staged.savedCells || {}).filter(([, cell]) => cell.rowKind !== 'story'));
                stagedIds = new Set([...stagedIds].filter(key => !key.startsWith('story:')));
                for (const cell of projection.cells) savedCells[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)] = cell;
                projection.entries.forEach(entry => stagedIds.add(`story:${entry.issueId}`));
                currentPlanEntries = projection.entries;
                if (!inclusion.dirty && !state.dirty && !pendingOperation) inclusion.discard(projection.entries, { planExists: projection.metadata.plan.exists });
                else if ([...inclusion.dirtyChanges.values()].some(change => {
                    const remote = projection.entries.find(entry => entry.issueId === change.issueId);
                    return remote && remote.revision !== change.baseRevision;
                })) publish({ conflict: { ...(staged.conflict || {}), planConflict: true }, error: 'The shared plan changed. Your draft is preserved.' });
                planProjectionSignature = projection.signature;
                const requestedIds = new Set(projection.requestedIds);
                publish({ savedCells, unavailableIssueIds: [...new Set([...(staged.unavailableIssueIds || []).filter(id => !requestedIds.has(id)), ...projection.unavailableIssueIds])] });
            }
            loadedIds = stagedIds; deferredRead = false;
            if (stageShared && !automatic) {
                // Typing can continue during an ordinary Refresh. Publish server baselines without
                // replacing edits or their original CAS revisions captured while the read was pending.
                for (const key of ['drafts', 'schemaChanges']) staged[key] = state[key];
                if (state.dirty) {
                    for (const key of ['savedColumns', 'schemaRevision', 'savedLayouts', 'savedViewRevision', 'savedInheritedFrom', 'plan', 'scopeProof']) staged[key] = state[key];
                } else {
                    Object.assign(staged, { savedColumns: staged.currentColumns, schemaRevision: staged.currentSchemaRevision,
                        savedLayouts: staged.currentLayouts, savedViewRevision: staged.currentViewRevision,
                        savedInheritedFrom: staged.currentInheritedFrom, plan: staged.currentPlan, scopeProof: staged.currentScopeProof });
                }
                const schemaConflict = state.schemaChanges.some(change => change.action !== 'layout') && staged.currentSchemaRevision !== state.schemaRevision;
                const viewConflict = state.schemaChanges.some(change => change.action === 'layout') && staged.currentViewRevision !== state.savedViewRevision;
                if (schemaConflict || viewConflict) {
                    staged.conflict = { ...(staged.conflict || {}), schemaConflict, viewConflict };
                    staged.error = 'The shared review changed. Your draft is preserved.';
                }
            }
            emit(automatic || stageShared ? { ...staged, groupBlocked: false } : { groupBlocked: false });
            return outcome('ok');
        } catch (error) {
            if (automatic && error.name === 'AuthenticationRequiredError') throw error;
            if (automatic && stageShared && current() && error.name !== 'AbortError') emit({ planReady: false, planStale: true, error: 'The shared plan could not be refreshed. Retry before making changes.' });
            // A manual refresh that fails part-way restores the pre-refresh cells, so no mixed-vintage cells remain.
            if (restore && generation === thisGeneration && !disposed) { loadedIds = restore.loadedIds; emit({ savedCells: restore.savedCells, unavailableIssueIds: restore.unavailableIssueIds }); }
            if (!automatic && generation === thisGeneration && error.name !== 'AbortError' && error.name !== 'AuthenticationRequiredError') emit({ ...(stageShared ? { planReady: false } : {}), error: 'Review could not be loaded. Your draft is preserved.' });
            return outcome(error.name === 'AbortError' || !current() ? 'ignored' : 'failed');
        } finally {
            lifetimeSignal.removeEventListener('abort', abort); options.signal?.removeEventListener('abort', abort);
            if (runningRead === read) {
                runningRead = null;
                if (!automatic) emit({ loading: false, forceLoading: false, progress: null });
                if (loadQueued) {
                    const queued = loadQueued; loadQueued = null;
                    void load(queued).then(result => queued.waiters.splice(0).forEach(waiter => waiter.resolve(result)), error => queued.waiters.splice(0).forEach(waiter => waiter.reject(error)));
                }
            }
        }
    }
    async function save() {
        if (state.saving || state.unconfirmed || pendingOperation) return false;
        if (!state.dirty) return true;
        if (state.saving || state.loading || !state.capabilities.canSave || state.unconfirmed || state.conflict || state.groupBlocked) return false;
        if (shared() && (!state.planReady || !state.planCapabilities?.canSave || !planScope || pendingOperation)) return false;
        const changes = Object.values(state.drafts);
        if (changes.some(cell => cell.valid === false)) { emit({ error: 'Correct invalid review cells before saving.' }); return false; }
        if (changes.length > 100) { emit({ error: 'Save supports up to 100 changed cells. Keep this draft and reduce the changed cells before saving.' }); return false; }
        const thisGeneration = generation;
        let refreshColumns = false;
        const layoutKinds = new Set(state.schemaChanges.filter(change => change.action === 'layout').map(change => change.rowKind));
        const columnAction = state.schemaChanges.some(change => change.action !== 'layout');
        // A first layout save in an inheriting Sprint sends the displayed view's other kinds too; never stored in schemaChanges.
        const injected = layoutKinds.size > 0 && state.savedViewRevision === 0 && state.savedInheritedFrom !== null
            ? REVIEW_ROLES.filter(rowKind => !layoutKinds.has(rowKind) && state.savedLayouts?.[rowKind]).map(rowKind => ({ action: 'layout', rowKind, order: [...(state.savedLayouts[rowKind].order || [])], hidden: [...(state.savedLayouts[rowKind].hidden || [])] }))
            : [];
        const reviewPayload = { groupId: state.groupId, baseSchemaRevision: state.schemaRevision, baseViewRevision: state.savedViewRevision, schemaChanges: [...state.schemaChanges, ...injected].map(change => toNativeChange(state.workModel, change)), cellChanges: changes.map(({ issueId, rowKind, columnId, value, baseRevision }) => ({ issueId, rowKind: toNativeKind(state.workModel, rowKind), columnId, value, baseRevision })) };
        const inclusionSnapshot = shared() ? { ...inclusion.snapshot(), initializePlan: !state.plan.exists } : null;
        if (shared()) {
            const ids = new Set([...inclusionSnapshot.changes.map(change => change.issueId), ...changes.map(cell => cell.issueId)]);
            if (ids.size > 500) { emit({ error: 'Save supports up to 500 changed stories. Keep this draft and reduce the changes before saving.' }); return false; }
            const payload = freezePlanningSavePayload({ ...reviewPayload, version: 2, operationId: createPlanningOperationId(), initializePlan: inclusionSnapshot.initializePlan, basePlanRevision: state.plan.revision, baseScopeProof: state.scopeProof, inclusionChanges: inclusionSnapshot.changes });
            if (new TextEncoder().encode(JSON.stringify(payload)).length > 256 * 1024) { emit({ error: 'The plan draft is too large. Keep this draft and reduce the changes before saving.' }); return false; }
            const expectedColumns = applyReviewSchemaChanges(state.savedColumns, state.schemaChanges).map((column, index, columns) => ({ ...column, label: column.label.trim(), aggregation: column.aggregation ?? (column.type === 'number' ? 'sum' : 'none'), archived: column.archived ?? false, after: column.after ?? null, order: column.order ?? columns.slice(0, index).filter(previous => previous.rowKind === column.rowKind).length }));
            pendingOperation = { payload, sequence: inclusionSnapshot.sequence, snapshot: inclusionSnapshot, expectedColumns, schemaChanges: state.schemaChanges.map(change => ({ ...change })) };
        }
        emit({ saving: true, error: '' });
        try {
            const data = fromServer(await saveReview(backendUrl, state.sprintId, shared() ? pendingOperation.payload : reviewPayload));
            if (generation !== thisGeneration) return false;
            if (shared()) {
                if (data.reloadRequired || data.operationId !== pendingOperation.payload.operationId || !data.plan?.exists || !Array.isArray(data.inclusionChanges) || !confirmColumns(data, pendingOperation)) throw Object.assign(new Error('The saved plan was not completely confirmed.'), { unconfirmed: true });
                inclusion.confirm(pendingOperation.snapshot, data.inclusionChanges);
                currentPlanEntries = [...inclusion.effectiveEntries.values()].map(entry => {
                    const dirty = inclusion.dirtyChanges.get(entry.issueId);
                    return dirty ? { ...entry, included: !dirty.included } : entry;
                });
                const confirmedOperationId = pendingOperation.payload.operationId;
                pendingOperation = null;
                emit({ plan: data.plan, currentPlan: data.plan, confirmedOperationId });
            }
            const layoutConfirmed = state.schemaChanges.filter(change => change.action === 'layout').every(change => {
                const saved = data.layouts?.[change.rowKind];
                return JSON.stringify(saved?.order) === JSON.stringify(change.order) && JSON.stringify(saved?.hidden) === JSON.stringify(change.hidden);
            });
            if (!layoutConfirmed) {
                emit({ unconfirmed: true, error: 'The server did not confirm your column layout. Your draft is preserved. Refresh and reapply before saving again.' });
                return false;
            }
            writeEpoch += 1;
            const savedCells = { ...state.savedCells };
            for (const cell of data.cells || data.cellChanges || []) savedCells[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)] = cell;
            // Apply only the keys present: a 200 without a layout action keeps the best known view, and
            // one without a column action records columns as current and refreshes to read a fresh column's cells.
            const saved = responseView(data);
            const view = 'layouts' in data ? { savedLayouts: data.layouts, currentLayouts: data.layouts, savedViewRevision: saved.viewRevision, currentViewRevision: saved.viewRevision, savedInheritedFrom: saved.inheritedFrom, currentInheritedFrom: saved.inheritedFrom }
                : { savedLayouts: state.currentLayouts, savedViewRevision: state.currentViewRevision, savedInheritedFrom: state.currentInheritedFrom };
            const columns = columnAction ? { savedColumns: data.columns || state.columns, currentColumns: data.columns || state.columns, schemaRevision: data.schemaRevision, currentSchemaRevision: data.schemaRevision }
                : 'columns' in data ? { currentColumns: data.columns, currentSchemaRevision: data.schemaRevision } : {};
            refreshColumns = !columnAction && 'schemaRevision' in data && data.schemaRevision !== state.schemaRevision;
            emit({ ...view, ...columns, savedCells, schemaChanges: [], drafts: {}, unconfirmed: false, conflict: null });
            return true;
        } catch (error) {
            if (generation === thisGeneration) {
                if (shared() && pendingOperation && !error.noCommit && !(error.status >= 400 && error.status < 500)) error.unconfirmed = true;
                if (shared() && !error.unconfirmed && error.name !== 'AuthenticationRequiredError') pendingOperation = null;
                if (error.code === 'configuration_scope_changed') { writeEpoch += 1; emit({ error: WORK_WRITE_ERROR_MESSAGES.configuration_scope_changed }); }
                else if (error.code === 'review_quarter_unresolved') emit({ layoutBlocked: true, error: LAYOUT_BLOCKED_MESSAGE });
                else if (error.status === 409) { writeEpoch += 1; emit({ conflict: error.conflict || {}, error: 'The shared review changed. Your draft is preserved.' }); }
                else if (error.name !== 'AuthenticationRequiredError') {
                    if (GROUP_BLOCKED_MESSAGES[error.code]) emit({ groupBlocked: true, error: GROUP_BLOCKED_MESSAGES[error.code] });
                    else if (REVIEW_LIMIT_MESSAGES[error.code]) emit({ error: REVIEW_LIMIT_MESSAGES[error.code] });
                    else emit({ unconfirmed: Boolean(error.unconfirmed), error: error.unconfirmed ? 'Save outcome is unconfirmed. Refresh review before deliberately resolving your draft.' : 'Review could not be saved. Your draft is preserved.' });
                }
                else if (shared()) emit({ unconfirmed: true });
            }
            return false;
        } finally {
            if (generation === thisGeneration) emit({ saving: false });
            if (refreshColumns && generation === thisGeneration) void load({ force: true, options: { automatic: true } }).catch(() => {});
        }
    }
    const clearReviewDraft = () => {
        writeEpoch += 1;
        emit({ savedLayouts: state.currentLayouts || state.savedLayouts, savedViewRevision: state.currentViewRevision, savedInheritedFrom: state.currentInheritedFrom, groupBlocked: false, schemaChanges: [], drafts: {}, conflict: null, error: '', unconfirmed: false, schemaRevision: state.currentSchemaRevision ?? state.schemaRevision, savedColumns: state.currentColumns?.length || state.schemaChanges.length ? state.currentColumns || state.savedColumns : state.savedColumns });
        return true;
    };
    async function discardPlan() {
        if (state.saving || state.discarding) return false;
        const thisGeneration = generation;
        emit({ discarding: true });
        try {
            if (pendingOperation) await reconcilePlan();
            if (!await load({ force: true }) || !state.planReady || thisGeneration !== generation) return false;
            inclusion.discard(currentPlanEntries, { planExists: state.currentPlan.exists });
            pendingOperation = null;
            emit({ plan: state.currentPlan, scopeProof: state.currentScopeProof, reconciliationRequired: false });
            return clearReviewDraft();
        } finally { if (thisGeneration === generation) emit({ discarding: false }); }
    }
    function changeInclusion(rows, included) {
        if (!shared() || !state.planReady || !state.planCapabilities?.canSave || state.loading || state.discarding || state.unconfirmed) return false;
        const allowed = new Set(currentPlanEntries.map(entry => entry.issueId)), candidates = new Set(candidateIds());
        const ids = [...new Set((rows || []).map(row => typeof row === 'string' ? row : !row.synthetic && (!row.rowKind || row.rowKind === 'story') ? String(row.issueId || row.id || '') : '').filter(id => allowed.has(id) && candidates.has(id)))];
        const before = inclusion.actionSequence;
        inclusion.apply(ids, included);
        if (before === inclusion.actionSequence) return false;
        writeEpoch += 1; emit({}); return true;
    }
    async function reconcilePlan() {
        if (!pendingOperation || !planScope || state.saving) return !state.unconfirmed;
        const operation = pendingOperation, thisGeneration = generation;
        try {
            const outcome = await readOperation(backendUrl, state.sprintId, operation.payload.operationId, { groupId: state.groupId, configurationId: planScope.namespaceId });
            if (generation !== thisGeneration || operation !== pendingOperation) return false;
            if (outcome.operationId !== operation.payload.operationId || outcome.status !== 'committed' || !outcome.plan?.exists || !Number.isSafeInteger(outcome.plan.revision) || outcome.plan.revision < 1) {
                emit({ unconfirmed: true, error: 'The original save outcome is still unknown. Review the current plan before deliberately resolving this draft.' }); return false;
            }
            if (!await load({ force: true }) || generation !== thisGeneration || !state.planReady) return false;
            // Metadata cannot establish original per-entry revisions after another plan write (ABA),
            // nor confirm review cells shared across Sprints. Require explicit current-state recovery then.
            const entries = operation.snapshot.changes.map(change => currentPlanEntries.find(entry => entry.issueId === change.issueId));
            if (operation.payload.schemaChanges.length || operation.payload.cellChanges.length || state.currentPlan.revision !== outcome.plan.revision || entries.some((entry, index) => !entry || entry.included !== operation.snapshot.changes[index].included)) {
                emit({ unconfirmed: true, reconciliationRequired: true, error: 'The original save committed. Review current values before keeping or discarding your remaining draft.' }); return false;
            }
            inclusion.confirm(operation.snapshot, entries);
            pendingOperation = null;
            emit({ plan: outcome.plan, scopeProof: state.currentScopeProof, unconfirmed: false, conflict: null, error: '', reconciliationRequired: false, confirmedOperationId: operation.payload.operationId });
            return true;
        } catch (error) {
            if (generation === thisGeneration && error.name !== 'AuthenticationRequiredError') emit({ unconfirmed: true, error: 'The original save outcome could not be checked. Your draft is preserved.' });
            return false;
        }
    }
    const controller = {
        getState: () => state,
        setRows: rows => { currentRows = rows; },
        setCandidates: rows => { currentCandidates = rows; },
        includeShown: rows => changeInclusion(rows, true),
        removeShown: rows => changeInclusion(rows, false),
        undoInclusion() {
            if (!shared() || state.saving || state.discarding || state.unconfirmed || state.loading || !inclusion.undo()) return false;
            writeEpoch += 1; emit({}); return true;
        },
        getPlanSnapshot: () => ({ ...inclusion.snapshot(), effectiveEntries: inclusion.effectiveEntries, plan: state.plan, scope: planScope ? { ...planScope } : null, pendingOperation: pendingOperation ? { payload: pendingOperation.payload, sequence: pendingOperation.sequence } : null }),
        getSelectedTasks: (rows = currentCandidates) => {
            const authorized = new Set(currentPlanEntries.map(entry => entry.issueId)), effective = inclusion.effectiveEntries;
            return Object.fromEntries(rows.filter(row => !row.synthetic && row.key && authorized.has(String(row.issueId || row.id)) && effective.get(String(row.issueId || row.id))?.included).map(row => [row.key, true]));
        },
        capturePlanRecovery() {
            if (!shared() || !planScope || !state.plan || typeof state.scopeProof !== 'string') return null;
            return {
                scope: { ...planScope }, selectedTeams: [],
                draft: { inclusionChanges: inclusion.snapshot().changes.map(change => ({ ...change })), initializePlan: inclusion.initializationPending || !state.plan.exists && state.dirty, basePlanRevision: state.plan.revision, baseScopeProof: state.scopeProof, baseSchemaRevision: state.schemaRevision, baseViewRevision: state.savedViewRevision, schemaChanges: state.schemaChanges.map(change => ({ ...change })), cellChanges: Object.values(state.drafts).map(({ issueId, rowKind, columnId, value, baseRevision, input, valid }) => ({ issueId, rowKind, columnId, value, baseRevision, input, valid })) },
                submission: pendingOperation ? { payload: pendingOperation.payload, sequence: pendingOperation.sequence } : null,
            };
        },
        async restorePlanRecovery(recovery) {
            if (!sameScope(recovery?.scope) || state.saving || state.dirty || pendingOperation || !recovery.draft || !Array.isArray(recovery.draft.inclusionChanges) || !Array.isArray(recovery.draft.schemaChanges) || !Array.isArray(recovery.draft.cellChanges)) return false;
            const thisGeneration = generation;
            const draft = recovery.draft, submission = recovery.submission;
            const submittedCells = fromServer({ cells: submission?.payload.cellChanges || [] }).cells;
            const recoveryRows = [...draft.cellChanges, ...submittedCells].map(({ issueId, rowKind }) => ({ issueId, rowKind }));
            const extraPlanIds = [...new Set([...draft.inclusionChanges, ...(submission?.payload.inclusionChanges || []), ...recoveryRows.filter(row => row.rowKind === 'story')].map(change => change.issueId))];
            if (!await load({ force: true, options: { recoveryRows, extraPlanIds } }) || thisGeneration !== generation || !state.planReady) return false;
            try {
                const baseline = new Map(currentPlanEntries.map(entry => [entry.issueId, { ...entry }]));
                for (const change of [...(submission?.payload.inclusionChanges || []), ...draft.inclusionChanges]) baseline.set(change.issueId, { issueId: change.issueId, included: !change.included, revision: change.baseRevision });
                const restored = createPlanningInclusionDraft({ entries: [...baseline.values()], planExists: draft.basePlanRevision > 0 });
                restored.restore(draft.inclusionChanges, { initializePlan: draft.initializePlan });
                const drafts = {};
                for (const cell of draft.cellChanges) {
                    const column = [...state.currentColumns, ...draft.schemaChanges.filter(change => change.action === 'add').map(change => change.column)].find(column => column.id === cell.columnId && column.rowKind === cell.rowKind && !column.archived);
                    const input = cell.input ?? String(cell.value ?? '');
                    const parsed = column ? validateReviewValue(column, input) : { valid: false };
                    drafts[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)] = { ...cell, input, valid: Boolean(parsed.valid && column && (cell.valid !== false)), value: parsed.valid ? parsed.value : cell.value };
                }
                let recoveredOperation = null;
                if (submission) {
                    const payload = JSON.parse(JSON.stringify(submission.payload));
                    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
                    freeze(payload);
                    recoveredOperation = { payload, sequence: submission.sequence, snapshot: { sequence: 0, initializePlan: payload.initializePlan, changes: payload.inclusionChanges }, expectedColumns: state.currentColumns, schemaChanges: [] };
                }
                const currentEntries = new Map(currentPlanEntries.map(entry => [entry.issueId, entry]));
                const planConflict = draft.inclusionChanges.some(change => !currentEntries.has(change.issueId) || currentEntries.get(change.issueId).revision !== change.baseRevision);
                const schemaConflict = draft.schemaChanges.some(change => change.action !== 'layout') && draft.baseSchemaRevision !== state.currentSchemaRevision;
                const viewConflict = draft.schemaChanges.some(change => change.action === 'layout') && draft.baseViewRevision !== state.currentViewRevision;
                const unavailable = new Set(state.unavailableIssueIds || []);
                const cellConflicts = draft.cellChanges.filter(cell => loadedIds.has(`${cell.rowKind}:${cell.issueId}`) && !unavailable.has(cell.issueId) && (state.savedCells[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)]?.revision ?? 0) !== cell.baseRevision).map(cell => ({ issueId: cell.issueId, rowKind: cell.rowKind, columnId: cell.columnId, value: state.savedCells[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)]?.value ?? null, revision: state.savedCells[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)]?.revision ?? 0 }));
                const unavailableDraftIds = [...new Set(recoveryRows.filter(row => unavailable.has(row.issueId) || !loadedIds.has(`${row.rowKind}:${row.issueId}`)).map(row => row.issueId))];
                const hasConflict = planConflict || schemaConflict || viewConflict || cellConflicts.length > 0 || unavailableDraftIds.length > 0;
                inclusion = restored; pendingOperation = recoveredOperation;
                writeEpoch += 1;
                emit({ plan: { exists: draft.basePlanRevision > 0, revision: draft.basePlanRevision }, scopeProof: draft.baseScopeProof, schemaRevision: draft.baseSchemaRevision, savedViewRevision: draft.baseViewRevision, schemaChanges: draft.schemaChanges, drafts, unconfirmed: Boolean(submission), conflict: hasConflict ? { planConflict, schemaConflict, viewConflict, cellConflicts, unavailableIssueIds: unavailableDraftIds } : null, error: hasConflict ? 'Shared values changed or are no longer available after recovery. Your draft is preserved.' : '' });
                if (submission) await reconcilePlan();
                return thisGeneration === generation;
            } catch (error) { return false; }
        },
        reconcilePlan,
        isRowReadable: row => loadedIds.has(`${row.rowKind}:${row.issueId}`),
        resumeDeferredRead(options = {}) {
            if (!deferredRead) return Promise.resolve({ status: 'ignored' });
            return load({ options: { ...options, automatic: true } });
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async setScope({ sprintId, groupId, contextKey, active: nextActive, rows = [], candidateRows = rows.filter(row => row.rowKind === 'story'), planScope: nextPlanScope = null, deferRead = false, workModel = 'legacy' }) {
            const nextGroupId = String(groupId || '');
            // An era switch is a context change: the other namespace's definitions, values and layout are never copied across.
            const contextChanged = contextKey !== state.contextKey || workModel !== state.workModel;
            const groupChanged = nextGroupId !== state.groupId;
            const sprintChanged = String(sprintId || '') !== state.sprintId;
            const planScopeChanged = shared() && nextPlanScope && !sameScope(nextPlanScope);
            if (shared() && (contextChanged || groupChanged || sprintChanged || planScopeChanged) && (state.dirty || state.saving || state.unconfirmed || pendingOperation)) return false;
            // A group change discards like a context change: drafts are bound to the group they were loaded under.
            if (contextChanged || groupChanged || planScopeChanged) { reset(sprintId, contextKey, nextGroupId, workModel); emit({ schemaLoaded: false, unavailableIssueIds: [] }); }
            else if (sprintChanged) {
                if (state.dirty) return false;
                reset(sprintId, contextKey, nextGroupId); emit({ schemaLoaded: false, unavailableIssueIds: [] });
            }
            currentRows = rows; currentCandidates = candidateRows; planScope = nextPlanScope ? { ...nextPlanScope } : null; active = nextActive;
            deferredRead = deferRead && !contextChanged && !sprintChanged && !groupChanged;
            return deferredRead ? false : load();
        },
        setCell(row, column, input) {
            if (row.synthetic || !row.issueId || !loadedIds.has(`${row.rowKind}:${row.issueId}`) || state.unavailableIssueIds?.includes(row.issueId) || !currentRows.some(candidate => !candidate.synthetic && candidate.rowKind === row.rowKind && candidate.issueId === row.issueId) || row.rowKind !== column.rowKind || !state.capabilities.canSave || state.saving || state.discarding) return { valid: false, error: 'This row cannot store review values.' };
            const parsed = validateReviewValue(column, input);
            const key = reviewCellKey(row.rowKind, row.issueId, column.id);
            const original = state.savedCells?.[key];
            const drafts = { ...state.drafts };
            const equivalent = column.type === 'number' ? parseReviewNumber(original?.value).value === parsed.value : (original?.value ?? null) === parsed.value;
            if (parsed.valid && equivalent) delete drafts[key];
            else drafts[key] = { issueId: row.issueId, rowKind: row.rowKind, columnId: column.id, value: parsed.value, input: String(input ?? ''), valid: parsed.valid, baseRevision: state.drafts[key]?.baseRevision ?? original?.revision ?? 0 };
            emit({ drafts });
            return parsed;
        },
        changeSchema(change) {
            writeEpoch += 1;
            if (!state.capabilities.canSave || state.saving || state.discarding) return false;
            if (change.action === 'layout' && state.layoutBlocked) { emit({ error: LAYOUT_BLOCKED_MESSAGE }); return false; }
            if (change.action === 'add') {
                if (!change.column?.id || !REVIEW_ROLES.includes(change.column.rowKind) || !['number', 'text'].includes(change.column.type) || !String(change.column.label).trim() || Array.from(change.column.label).length > 80 || state.columns.filter(column => column.rowKind === change.column.rowKind && !column.archived).length >= 30) return false;
            }
            if (change.action === 'archive' && Object.values(state.drafts).some(cell => cell.columnId === change.columnId)) { emit({ error: 'Save or discard this column’s draft cells before archiving it.' }); return false; }
            if (change.action === 'rename' && (!String(change.label).trim() || Array.from(change.label).length > 80)) return false;
            emit({ schemaChanges: [...state.schemaChanges.filter(previous => change.action !== 'layout' || previous.action !== 'layout' || previous.rowKind !== change.rowKind), change] });
            return true;
        },
        save,
        discard() { return state.saving ? false : shared() ? discardPlan() : clearReviewDraft(); },
        refresh: options => load({ force: true, options }),
        async loadCurrent() { if (shared()) return discardPlan(); if (!await load({ force: true })) return false; return controller.discard(); },
        async reapply() {
            if (!await load({ force: true })) return false;
            const unavailableColumns = state.schemaChanges.some(change => change.action === 'add' && state.currentColumns.some(column => column.id === change.column.id) || change.action !== 'add' && change.action !== 'reorder' && change.action !== 'layout' && !state.currentColumns.some(column => column.id === change.columnId)) || Object.values(state.drafts).some(cell => ![...state.currentColumns, ...state.schemaChanges.filter(change => change.action === 'add').map(change => change.column)].some(column => column.id === cell.columnId && !column.archived));
            if (unavailableColumns) { emit({ error: 'The shared column definitions changed. Load current, or copy the draft into available columns.' }); return false; }
            if (shared()) {
                if (!state.planReady) return false;
                const desired = [...inclusion.dirtyChanges.values()].map(change => ({ issueId: change.issueId, included: change.included }));
                if (pendingOperation) for (const change of pendingOperation.snapshot.changes) if (!desired.some(item => item.issueId === change.issueId)) desired.push({ issueId: change.issueId, included: !change.included });
                const authorized = new Set(currentPlanEntries.map(entry => entry.issueId));
                if (desired.some(change => !authorized.has(change.issueId))) { emit({ error: 'Some draft stories are no longer available. Review current values before resolving the draft.' }); return false; }
                inclusion.discard(currentPlanEntries, { planExists: state.currentPlan.exists });
                for (const included of [true, false]) inclusion.apply(desired.filter(change => change.included === included).map(change => change.issueId), included);
                pendingOperation = null;
                emit({ plan: state.currentPlan, scopeProof: state.currentScopeProof, reconciliationRequired: false });
            }
            const drafts = Object.fromEntries(Object.entries(state.drafts).map(([key, cell]) => [key, { ...cell, baseRevision: state.savedCells[key]?.revision ?? 0 }]));
            emit({ drafts, savedLayouts: state.currentLayouts || {}, savedViewRevision: state.currentViewRevision, savedInheritedFrom: state.currentInheritedFrom, savedColumns: state.currentColumns, schemaRevision: state.currentSchemaRevision, conflict: null, unconfirmed: false, error: '' });
            return true;
        },
        guardScopeChange(callback) {
            if (!state.dirty && !state.saving && !state.unconfirmed && !pendingOperation) { callback(); return Promise.resolve(true); }
            if (pendingScope) return Promise.resolve(false);
            return new Promise(resolve => { pendingScope = { callback, resolve }; emit({ pendingScopeChange: true }); });
        },
        async resolveScopeChange(choice) {
            if (!pendingScope || state.saving) return false;
            if (choice === 'save') {
                const saved = await save();
                onReviewAction?.('save_review', { result: saved ? 'success' : state.unconfirmed ? 'unknown' : state.conflict ? 'conflict' : 'failure' });
                if (!saved) return false;
            }
            if (choice === 'discard') { if (!await controller.discard()) return false; onReviewAction?.('discard_review'); }
            const pending = pendingScope; pendingScope = null; emit({ pendingScopeChange: false });
            if (choice !== 'stay') pending.callback();
            pending.resolve(choice !== 'stay'); return choice !== 'stay';
        },
        dispose() { settleQueued('ignored'); disposed = true; generation += 1; lifetime.abort(); listeners.clear(); pendingScope?.resolve(false); },
    };
    return controller;
}

export default function usePlanningSprintReview({ sprintId, groupId, active = false, contextKey, backendUrl = '', rows = [], candidateRows = rows.filter(row => row.rowKind === 'story'), planScope, controller: suppliedController, onReviewAction, automaticHoldRef, workModel = 'legacy' }) {
    const actionRef = React.useRef(onReviewAction); actionRef.current = onReviewAction;
    const controller = React.useMemo(() => suppliedController || createPlanningSprintReviewController({ backendUrl, onReviewAction: (action, params) => actionRef.current?.(action, params) }), [backendUrl, suppliedController]);
    const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
    controller.setRows(rows);
    controller.setCandidates(candidateRows);
    const deferRead = automaticHoldRef?.current > 0;
    const rowSignature = rows.filter(row => !row.synthetic && row.issueId).map(row => `${row.rowKind}:${row.issueId}`).sort().join('|');
    const candidateSignature = candidateRows.filter(row => !row.synthetic && (row.issueId || row.id)).map(row => String(row.issueId || row.id)).sort().join('|');
    const planScopeSignature = JSON.stringify(planScope || null);
    React.useEffect(() => { void controller.setScope({ sprintId, groupId, active, contextKey, rows, candidateRows, planScope, deferRead, workModel }); }, [controller, sprintId, groupId, active, contextKey, workModel, rowSignature, candidateSignature, planScopeSignature]);
    React.useEffect(() => {
        const leave = event => { if (controller.getState().dirty || controller.getState().saving || controller.getState().unconfirmed) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', leave);
        return () => window.removeEventListener('beforeunload', leave);
    }, [controller]);
    React.useEffect(() => () => controller.dispose(), [controller]);
    return { ...state, ...controller };
}
export { usePlanningSprintReview };
