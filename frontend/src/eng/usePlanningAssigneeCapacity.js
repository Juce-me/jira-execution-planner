import * as React from 'react';
import { fetchAssigneeCapacity, saveAssigneeCapacity } from '../api/assigneeCapacityApi.js';
import { applyChangesToDocument, buildChanges, chunkChanges, pruneChange } from './planningAssigneeCapacityModel.js';

const SAVE_DELAY_MS = 200;
const SETTLE_MS = 250;
const isAuthError = error => error?.name === 'AuthenticationRequiredError';
const isAbort = error => error?.name === 'AbortError';
const scopeKeyOf = (sprintId, teamId) => (sprintId && teamId ? `${sprintId}|${teamId}` : '');
const EMPTY = Object.freeze({ scopeKey: '', sprintId: '', teamId: '', load: 'idle', save: 'idle', error: '', document: null, changes: [], capabilities: { canRead: false, canSave: false } });

// One queue per (Sprint, Team): the unsaved changes, at most one request in flight, and the last known document.
const newQueue = (sprintId, teamId, document) => ({ sprintId, teamId, document, pending: new Map(), inFlight: [], failed: new Map(), timer: null, running: false, stopped: false, writeEpoch: 0 });

// Later commits override earlier values per field; a displayName only ever refreshes.
function mergeInto(target, change) {
    const entry = target.get(change.assigneeKey) || { assigneeKey: change.assigneeKey };
    target.set(change.assigneeKey, { ...entry, ...change });
}

// Framework-free controller (as the sprint review controller): the React hook below only subscribes to it.
export function createAssigneeCapacityController({ backendUrl = '', fetchCapacity = fetchAssigneeCapacity, saveCapacity = saveAssigneeCapacity, saveDelay = SAVE_DELAY_MS, settleDelay = SETTLE_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let state = EMPTY;
    let current = null, active = false, generation = 0, disposed = false, loadAbort = null, loadTimer = null;
    const cache = new Map();
    const csrf = { token: null };
    const listeners = new Set();

    const overlay = queue => (queue ? [...queue.failed.values(), ...queue.inFlight, ...queue.pending.values()] : []);
    const publish = patch => {
        const queue = current;
        state = { ...state, ...patch, changes: overlay(queue) };
        if (queue) state.document = queue.document;
        listeners.forEach(listener => listener());
    };
    const isCurrent = queue => !disposed && queue === current;

    async function load(queue) {
        if (!isCurrent(queue) || !active || queue.running || queue.pending.size) return;
        loadAbort?.abort();
        const controller = new AbortController();
        loadAbort = controller;
        const epoch = queue.writeEpoch, thisGeneration = generation;
        if (!queue.document) publish({ load: 'loading', error: '' });
        try {
            const data = await fetchCapacity(backendUrl, queue.sprintId, queue.teamId, { signal: controller.signal });
            // A write started or finished meanwhile makes this read stale; the queue's own response wins.
            if (!isCurrent(queue) || generation !== thisGeneration || queue.writeEpoch !== epoch || controller.signal.aborted) return;
            queue.document = data;
            cache.set(scopeKeyOf(queue.sprintId, queue.teamId), data);
            publish({ load: 'ready', capabilities: data.capabilities || { canRead: false, canSave: false }, error: state.save === 'failed' ? state.error : '' });
        } catch (error) {
            if (isAbort(error) || isAuthError(error) || !isCurrent(queue) || generation !== thisGeneration) return;
            if (!queue.document) publish({ load: 'error' });
        } finally {
            if (loadAbort === controller) loadAbort = null;
        }
    }

    // Sends one chunk; resolves to the saved document or throws. A 403 csrf_required refetches the token once.
    async function send(queue, chunk) {
        const call = () => saveCapacity(backendUrl, queue.sprintId, { teamId: queue.teamId, changes: chunk }, { csrf });
        try { return await call(); }
        catch (error) {
            if (error.status === 403 && error.code === 'csrf_required') { csrf.token = null; return call(); }
            throw error;
        }
    }

    const asDocument = (queue, data) => ({ ...queue.document, teamId: queue.teamId, sprintId: queue.sprintId, revision: data.revision, rows: data.rows || [], inherited: null });

    // An unconfirmed PATCH: read the document back and resend only the fields that differ.
    async function recover(queue, chunk) {
        const fresh = await fetchCapacity(backendUrl, queue.sprintId, queue.teamId, {});
        queue.document = { ...fresh };
        const remaining = chunk.map(change => pruneChange(change, fresh)).filter(Boolean);
        if (!remaining.length) return;
        queue.document = asDocument(queue, await send(queue, remaining));
    }

    async function pump(queue) {
        if (queue.running || queue.stopped) return;
        queue.running = true;
        queue.timer = null;
        try {
            while (queue.pending.size && !queue.stopped) {
                queue.failed.forEach((change, key) => mergeInto(queue.pending, change));
                queue.failed.clear();
                queue.inFlight = [...queue.pending.values()];
                queue.pending.clear();
                const changes = queue.inFlight.map(change => pruneChange(change, queue.document)).filter(Boolean);
                if (!changes.length) { queue.inFlight = []; if (isCurrent(queue)) publish({}); continue; }
                queue.writeEpoch += 1;
                if (isCurrent(queue)) publish({ save: 'saving', error: '' });
                let done = 0;
                try {
                    for (const chunk of chunkChanges(changes)) {
                        try { queue.document = asDocument(queue, await send(queue, chunk)); }
                        catch (error) {
                            if (!error.unconfirmed || isAuthError(error)) throw error;
                            await recover(queue, chunk);
                        }
                        done += chunk.length;
                    }
                    queue.inFlight = [];
                    queue.writeEpoch += 1;
                    cache.set(scopeKeyOf(queue.sprintId, queue.teamId), queue.document);
                    if (isCurrent(queue)) publish({ save: queue.pending.size ? 'saving' : 'saved', error: '', load: 'ready' });
                } catch (error) {
                    queue.writeEpoch += 1;
                    // The failed batch stays visible as drafts and rides along with the next commit or retry.
                    const unsent = queue.inFlight.filter(change => changes.slice(done).some(item => item.assigneeKey === change.assigneeKey));
                    queue.inFlight = [];
                    if (isAuthError(error)) { unsent.forEach(change => mergeInto(queue.pending, change)); queue.stopped = true; if (isCurrent(queue)) publish({ save: 'idle' }); }
                    else {
                        unsent.forEach(change => mergeInto(queue.failed, change));
                        if (isCurrent(queue)) publish({ save: 'failed', error: error.message || 'Assignee capacity could not be saved.' });
                    }
                    return;
                }
            }
        } finally {
            queue.running = false;
        }
    }

    const schedule = queue => { if (queue.timer == null && !queue.running) queue.timer = setTimer(() => { queue.timer = null; void pump(queue); }, saveDelay); };
    const flush = queue => { if (!queue) return; if (queue.timer != null) { clearTimer(queue.timer); queue.timer = null; } if (queue.pending.size || queue.failed.size) { queue.failed.forEach(change => mergeInto(queue.pending, change)); queue.failed.clear(); void pump(queue); } };

    const controller = {
        getState: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        setScope({ sprintId, teamId, active: nextActive }) {
            disposed = false;
            const key = scopeKeyOf(sprintId, teamId);
            const activeChanged = active !== Boolean(nextActive);
            active = Boolean(nextActive);
            if (key === state.scopeKey) {
                if (activeChanged && active && current) void load(current);
                return;
            }
            // Leaving a scope sends its unsaved commits first; their outcome no longer shows here.
            const previous = current;
            flush(previous);
            generation += 1;
            loadAbort?.abort(); loadAbort = null;
            if (loadTimer != null) { clearTimer(loadTimer); loadTimer = null; }
            current = key ? newQueue(String(sprintId), String(teamId), cache.get(key) || null) : null;
            const cached = current?.document || null;
            state = { ...EMPTY, scopeKey: key, sprintId: String(sprintId || ''), teamId: String(teamId || ''), load: cached ? 'ready' : 'idle', document: cached, capabilities: cached?.capabilities || EMPTY.capabilities };
            publish({});
            if (current && active) {
                const queue = current;
                if (previous) loadTimer = setTimer(() => { loadTimer = null; void load(queue); }, settleDelay);
                else void load(queue);
            }
        },
        // Records one validated commit; returns false when it cannot be saved here. `buildShown(document)` gives
        // the rows as displayed ({ rows, removedKeys }) so a commit equal to what is shown sends nothing.
        commit(commit, buildShown) {
            const queue = current;
            if (!queue?.document || !state.capabilities.canSave || queue.stopped) return false;
            const shown = buildShown(applyChangesToDocument(queue.document, overlay(queue)));
            const changes = buildChanges([commit], shown.rows, shown.removedKeys);
            if (!changes.length) return true;
            queue.failed.forEach(change => mergeInto(queue.pending, change));
            queue.failed.clear();
            changes.forEach(change => mergeInto(queue.pending, change));
            publish({ save: queue.running ? 'saving' : state.save === 'failed' ? 'idle' : state.save, error: '' });
            schedule(queue);
            return true;
        },
        retry() { const queue = current; if (queue && queue.failed.size && !queue.stopped) { flush(queue); publish({ error: '' }); } },
        flush() { flush(current); },
        // Re-reads the document (e.g. after a manual refresh); never while drafts are unsaved.
        reload() { if (current && active) void load(current); },
        isBusy: () => Boolean(current && (current.running || current.pending.size || current.failed.size)),
        dispose() { flush(current); disposed = true; loadAbort?.abort(); if (loadTimer != null) { clearTimer(loadTimer); loadTimer = null; } },
    };
    return controller;
}

export default function usePlanningAssigneeCapacity({ backendUrl = '', sprintId, teamId, active }) {
    const controller = React.useMemo(() => createAssigneeCapacityController({ backendUrl }), [backendUrl]);
    const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
    React.useEffect(() => { controller.setScope({ sprintId, teamId, active }); }, [controller, sprintId, teamId, active]);
    React.useEffect(() => () => controller.dispose(), [controller]);
    return { state, controller };
}
