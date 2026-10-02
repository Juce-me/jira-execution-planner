import * as React from 'react';
import { fetchSprintReview, readSprintReviewValues, saveSprintReview } from '../api/sprintReviewApi.js';
import { reviewCellKey, validateReviewValue, parseReviewNumber } from './planningReviewTableModel.js';

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

export function createPlanningSprintReviewController({ backendUrl = '', fetchSchema = fetchSprintReview, readValues = readSprintReviewValues, saveReview = saveSprintReview, onReviewAction } = {}) {
    let state = { sprintId: '', contextKey: '', columns: [], cells: {}, schemaRevision: 0, schemaChanges: [], drafts: {}, capabilities: { canRead: false, canSave: false }, dirty: false, loading: false, saving: false, error: '', conflict: null, unconfirmed: false, progress: null, pendingScopeChange: false };
    let currentRows = [], active = false, generation = 0, pendingScope = null, disposed = false;
    let loadedIds = new Set();
    let loadQueued = false;
    let lifetime = new AbortController();
    const listeners = new Set();
    const emit = patch => {
        state = { ...state, ...patch };
        state.dirty = state.schemaChanges.length > 0 || Object.keys(state.drafts).length > 0;
        state.layouts = applyReviewLayoutChanges(state.savedLayouts, state.schemaChanges);
        state.columns = applyReviewSchemaChanges(state.savedColumns || [], state.schemaChanges);
        state.cells = { ...(state.savedCells || {}), ...Object.fromEntries(Object.entries(state.drafts).filter(([, cell]) => cell.valid !== false)) };
        listeners.forEach(listener => listener());
    };
    const reset = (sprintId, contextKey) => {
        generation += 1;
        pendingScope?.resolve(false); pendingScope = null; loadQueued = false;
        lifetime.abort(); lifetime = new AbortController(); loadedIds = new Set();
        state = { ...state, sprintId: String(sprintId || ''), contextKey, savedColumns: [], savedLayouts: {}, currentLayouts: {}, savedCells: {}, schemaRevision: 0, schemaChanges: [], drafts: {}, columns: [], cells: {}, capabilities: { canRead: false, canSave: false }, loading: false, saving: false, error: '', conflict: null, unconfirmed: false, progress: null, pendingScopeChange: false, schemaLoaded: false, currentSchemaRevision: 0, currentColumns: [], unavailableIssueIds: [] };
        emit({});
    };
    async function load({ force = false } = {}) {
        if (!active || !state.sprintId || !state.contextKey || disposed || state.saving) return false;
        if (state.loading) { loadQueued = true; return false; }
        const thisGeneration = generation;
        const sprintId = state.sprintId;
        const signal = lifetime.signal;
        emit({ loading: true, error: '', progress: { completed: 0, total: 0 } });
        try {
            if (force || !state.schemaLoaded) {
                const schema = await fetchSchema(backendUrl, sprintId, { signal });
                if (generation !== thisGeneration || disposed) return false;
                // Refresh retains every draft and its original revision until explicit recovery.
                emit({ savedColumns: state.dirty ? state.savedColumns : schema.columns || [], currentColumns: schema.columns || [], savedLayouts: state.dirty ? state.savedLayouts : schema.layouts || {}, currentLayouts: schema.layouts || {}, schemaRevision: state.dirty ? state.schemaRevision : schema.schemaRevision, currentSchemaRevision: schema.schemaRevision, capabilities: schema.capabilities || {}, schemaLoaded: true, ...(state.dirty && schema.schemaRevision !== state.schemaRevision ? { conflict: { schemaConflict: true }, error: 'The shared columns changed. Your draft is preserved.' } : {}) });
            }
            if (!state.capabilities.canRead) return true;
            const requested = [...currentRows.filter(row => !row.synthetic && row.issueId && ['epic', 'story'].includes(row.rowKind)), ...(force ? Object.values(state.drafts).map(cell => ({ issueId: cell.issueId, rowKind: cell.rowKind })) : [])];
            const batches = [];
            for (const rowKind of ['epic', 'story']) {
                const ids = [...new Set(requested.filter(row => row.rowKind === rowKind).map(row => row.issueId))].filter(id => force || !loadedIds.has(`${rowKind}:${id}`));
                for (let offset = 0; offset < ids.length; offset += 500) batches.push({ rowKind, issueIds: ids.slice(offset, offset + 500) });
            }
            const total = batches.reduce((sum, batch) => sum + batch.issueIds.length, 0);
            let completed = 0;
            emit({ progress: { completed, total } });
            for (const batch of batches) {
                let data;
                try { data = await readValues(backendUrl, sprintId, batch, { signal }); }
                catch (error) {
                    if (error.status !== 413 || batch.issueIds.length < 2) throw error;
                    const middle = Math.ceil(batch.issueIds.length / 2);
                    const index = batches.indexOf(batch);
                    batches.splice(index + 1, 0, { ...batch, issueIds: batch.issueIds.slice(0, middle) }, { ...batch, issueIds: batch.issueIds.slice(middle) });
                    continue;
                }
                if (generation !== thisGeneration || disposed) return false;
                const savedCells = { ...state.savedCells };
                const unavailable = new Set(data.unavailableIssueIds || []);
                if (force) {
                    for (const [key, cell] of Object.entries(savedCells)) {
                        if (cell.rowKind === batch.rowKind && batch.issueIds.includes(cell.issueId)) delete savedCells[key];
                    }
                }
                for (const cell of data.cells || []) savedCells[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)] = cell;
                batch.issueIds.forEach(id => { if (!unavailable.has(id)) loadedIds.add(`${batch.rowKind}:${id}`); });
                completed += batch.issueIds.length;
                emit({ savedCells, progress: { completed, total }, unavailableIssueIds: [...new Set([...(state.unavailableIssueIds || []), ...unavailable])] });
            }
            return true;
        } catch (error) {
            if (generation === thisGeneration && error.name !== 'AbortError' && error.name !== 'AuthenticationRequiredError') emit({ error: 'Review could not be loaded. Your draft is preserved.' });
            return false;
        } finally {
            if (generation === thisGeneration) { emit({ loading: false, progress: null }); if (loadQueued) { loadQueued = false; void load(); } }
        }
    }
    async function save() {
        if (!state.dirty) return true;
        if (state.saving || state.loading || !state.capabilities.canSave || state.unconfirmed || state.conflict) return false;
        const changes = Object.values(state.drafts);
        if (changes.some(cell => cell.valid === false)) { emit({ error: 'Correct invalid review cells before saving.' }); return false; }
        if (changes.length > 100) { emit({ error: 'Save supports up to 100 changed cells. Keep this draft and reduce the changed cells before saving.' }); return false; }
        const thisGeneration = generation;
        emit({ saving: true, error: '' });
        try {
            const data = await saveReview(backendUrl, state.sprintId, { baseSchemaRevision: state.schemaRevision, schemaChanges: state.schemaChanges, cellChanges: changes.map(({ issueId, rowKind, columnId, value, baseRevision }) => ({ issueId, rowKind, columnId, value, baseRevision })) });
            if (generation !== thisGeneration) return false;
            const layoutConfirmed = state.schemaChanges.filter(change => change.action === 'layout').every(change => {
                const saved = data.layouts?.[change.rowKind];
                return JSON.stringify(saved?.order) === JSON.stringify(change.order) && JSON.stringify(saved?.hidden) === JSON.stringify(change.hidden);
            });
            if (!layoutConfirmed) {
                emit({ unconfirmed: true, error: 'The server did not confirm your column layout. Your draft is preserved. Refresh and reapply before saving again.' });
                return false;
            }
            const savedCells = { ...state.savedCells };
            for (const cell of data.cells || data.cellChanges || []) savedCells[reviewCellKey(cell.rowKind, cell.issueId, cell.columnId)] = cell;
            emit({ savedLayouts: data.layouts || state.layouts, currentLayouts: data.layouts || state.layouts, savedColumns: data.columns || state.columns, currentColumns: data.columns || state.columns, savedCells, schemaRevision: data.schemaRevision, currentSchemaRevision: data.schemaRevision, schemaChanges: [], drafts: {}, unconfirmed: false, conflict: null });
            return true;
        } catch (error) {
            if (generation === thisGeneration) {
                if (error.status === 409) emit({ conflict: error.conflict || {}, error: 'The shared review changed. Your draft is preserved.' });
                else if (error.name !== 'AuthenticationRequiredError') emit({ unconfirmed: Boolean(error.unconfirmed), error: error.unconfirmed ? 'Save outcome is unconfirmed. Refresh review before deliberately resolving your draft.' : 'Review could not be saved. Your draft is preserved.' });
            }
            return false;
        } finally { if (generation === thisGeneration) emit({ saving: false }); }
    }
    const controller = {
        getState: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async setScope({ sprintId, contextKey, active: nextActive, rows = [] }) {
            const contextChanged = contextKey !== state.contextKey;
            const sprintChanged = String(sprintId || '') !== state.sprintId;
            if (contextChanged) { reset(sprintId, contextKey); emit({ schemaLoaded: false, unavailableIssueIds: [] }); }
            else if (sprintChanged) {
                if (state.dirty) return false;
                reset(sprintId, contextKey); emit({ schemaLoaded: false, unavailableIssueIds: [] });
            }
            currentRows = rows; active = nextActive;
            return load();
        },
        setCell(row, column, input) {
            if (row.synthetic || !row.issueId || row.rowKind !== column.rowKind || !state.capabilities.canSave || state.saving) return { valid: false, error: 'This row cannot store review values.' };
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
            if (!state.capabilities.canSave || state.saving) return false;
            if (change.action === 'add') {
                if (!change.column?.id || !['epic', 'story'].includes(change.column.rowKind) || !['number', 'text'].includes(change.column.type) || !String(change.column.label).trim() || Array.from(change.column.label).length > 80 || state.columns.filter(column => column.rowKind === change.column.rowKind && !column.archived).length >= 30) return false;
            }
            if (change.action === 'archive' && Object.values(state.drafts).some(cell => cell.columnId === change.columnId)) { emit({ error: 'Save or discard this column’s draft cells before archiving it.' }); return false; }
            if (change.action === 'rename' && (!String(change.label).trim() || Array.from(change.label).length > 80)) return false;
            emit({ schemaChanges: [...state.schemaChanges.filter(previous => change.action !== 'layout' || previous.action !== 'layout' || previous.rowKind !== change.rowKind), change] });
            return true;
        },
        save,
        discard() { if (state.saving) return false; emit({ savedLayouts: state.currentLayouts || state.savedLayouts, schemaChanges: [], drafts: {}, conflict: null, error: '', unconfirmed: false, schemaRevision: state.currentSchemaRevision ?? state.schemaRevision, savedColumns: state.currentColumns?.length || state.schemaChanges.length ? state.currentColumns || state.savedColumns : state.savedColumns }); return true; },
        refresh: () => load({ force: true }),
        async loadCurrent() { if (!await load({ force: true })) return false; return controller.discard(); },
        async reapply() {
            if (!await load({ force: true })) return false;
            const unavailableColumns = state.schemaChanges.some(change => change.action === 'add' && state.currentColumns.some(column => column.id === change.column.id) || change.action !== 'add' && change.action !== 'reorder' && change.action !== 'layout' && !state.currentColumns.some(column => column.id === change.columnId)) || Object.values(state.drafts).some(cell => ![...state.currentColumns, ...state.schemaChanges.filter(change => change.action === 'add').map(change => change.column)].some(column => column.id === cell.columnId && !column.archived));
            if (unavailableColumns) { emit({ error: 'The shared column definitions changed. Load current, or copy the draft into available columns.' }); return false; }
            const drafts = Object.fromEntries(Object.entries(state.drafts).map(([key, cell]) => [key, { ...cell, baseRevision: state.savedCells[key]?.revision ?? 0 }]));
            emit({ drafts, savedLayouts: state.currentLayouts || {}, savedColumns: state.currentColumns, schemaRevision: state.currentSchemaRevision, conflict: null, unconfirmed: false, error: '' });
            return true;
        },
        guardScopeChange(callback) {
            if (!state.dirty && !state.saving) { callback(); return Promise.resolve(true); }
            if (pendingScope) return Promise.resolve(false);
            return new Promise(resolve => { pendingScope = { callback, resolve }; emit({ pendingScopeChange: true }); });
        },
        async resolveScopeChange(choice) {
            if (!pendingScope || state.saving) return false;
            if (choice === 'save') { const saved = await save(); onReviewAction?.('save_review', { result: saved ? 'success' : 'failure' }); if (!saved) return false; }
            if (choice === 'discard') { if (!controller.discard()) return false; onReviewAction?.('discard_review'); }
            const pending = pendingScope; pendingScope = null; emit({ pendingScopeChange: false });
            if (choice !== 'stay') pending.callback();
            pending.resolve(choice !== 'stay'); return choice !== 'stay';
        },
        dispose() { disposed = true; generation += 1; lifetime.abort(); listeners.clear(); pendingScope?.resolve(false); },
    };
    return controller;
}

export default function usePlanningSprintReview({ sprintId, active = false, contextKey, backendUrl = '', rows = [], onReviewAction }) {
    const actionRef = React.useRef(onReviewAction); actionRef.current = onReviewAction;
    const controller = React.useMemo(() => createPlanningSprintReviewController({ backendUrl, onReviewAction: (action, params) => actionRef.current?.(action, params) }), [backendUrl]);
    const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
    const rowSignature = rows.filter(row => !row.synthetic && row.issueId).map(row => `${row.rowKind}:${row.issueId}`).sort().join('|');
    React.useEffect(() => { void controller.setScope({ sprintId, active, contextKey, rows }); }, [controller, sprintId, active, contextKey, rowSignature]);
    React.useEffect(() => {
        const leave = event => { if (controller.getState().dirty || controller.getState().saving) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', leave);
        return () => window.removeEventListener('beforeunload', leave);
    }, [controller]);
    React.useEffect(() => () => controller.dispose(), [controller]);
    return { ...state, ...controller };
}
export { usePlanningSprintReview };
