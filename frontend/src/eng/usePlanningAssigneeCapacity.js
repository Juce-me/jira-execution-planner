import * as React from 'react';
import { fetchAssigneeCapacity, saveAssigneeCapacity } from '../api/assigneeCapacityApi.js';
import { AUTH_SESSION_REFRESH_EVENT } from '../api/authRefreshContract.js';
import {
    applyChangesToDocument, buildChanges, chunkChanges, effectivePlanned, isPlannedChange, isPlannedNoop, isValidDisplayName, PLANNED_SLOT, plannedNumber, plannedWireValue,
    pruneChange, samePlannedValue, sanitizeDisplayName,
} from './planningAssigneeCapacityModel.js';

const SAVE_DELAY_MS = 200;
const SETTLE_MS = 250;
const isAuthError = error => error?.name === 'AuthenticationRequiredError';
const isAbort = error => error?.name === 'AbortError';
// The server refused the change itself (shape or size): resending it would fail every later batch too.
const isRejected = error => error?.status === 400 || error?.status === 413;
// Scopes left with a failed or still running save are kept for the page session (the last five), so a revisit
// shows Not saved with Retry and the drafts.
export const MAX_PARKED_SCOPES = 5;
const scopeKeyOf = (sprintId, teamId) => (sprintId && teamId ? `${sprintId}|${teamId}` : '');
const EMPTY = Object.freeze({ scopeKey: '', sprintId: '', teamId: '', load: 'idle', save: 'idle', error: '', origin: '', document: null, changes: [], plannedSave: '', capabilities: { canRead: false, canSave: false } });
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// A re-read that changes none of these leaves the shown document as it is.
const sameDocument = (a, b) => Boolean(a && b) && a.revision === b.revision && sameValue(a.planned, b.planned) && sameValue(a.inherited, b.inherited);

// One queue per (Sprint, Team): the unsaved changes, at most one request in flight, and the last known document.
// `failed` holds changes whose request failed (they ride along with the next commit); `rejected` holds changes the
// server refused, which wait for Retry or Discard so one bad change cannot fail later batches.
const newQueue = (sprintId, teamId, document) => ({ sprintId, teamId, document, pending: new Map(), inFlight: [], failed: new Map(), rejected: new Map(), error: '', timer: null, running: false, stopped: false, writeEpoch: 0 });
const hasFailures = queue => Boolean(queue.failed.size || queue.rejected.size);
const hasDrafts = queue => Boolean(queue.pending.size || hasFailures(queue));

// Later commits override earlier values per field; a displayName only ever refreshes.
function mergeInto(target, change) {
    const entry = target.get(change.assigneeKey) || { assigneeKey: change.assigneeKey };
    target.set(change.assigneeKey, { ...entry, ...change });
}

// Failed changes go back under the pending ones (a newer commit of the same field wins); with `rejected` too (Retry).
function revive(queue, { rejected = false } = {}) {
    const merged = new Map();
    [...(rejected ? [queue.rejected] : []), queue.failed, queue.pending].forEach(map => map.forEach(change => mergeInto(merged, change)));
    queue.pending = merged;
    queue.failed.clear();
    if (rejected) queue.rejected.clear();
}

// A new commit of a field replaces that field's rejected value.
function supersede(queue, change) {
    const old = queue.rejected.get(change.assigneeKey);
    if (!old) return;
    const rest = { ...old };
    Object.keys(change).forEach(field => { if (field !== 'assigneeKey') delete rest[field]; });
    if (Object.keys(rest).some(field => field !== 'assigneeKey' && field !== 'displayName')) queue.rejected.set(change.assigneeKey, rest);
    else queue.rejected.delete(change.assigneeKey);
}

// The name snapshot is checked before sending (at most 200 characters, no control characters).
function withValidName(change) {
    if (!('displayName' in change) || isValidDisplayName(change.displayName)) return change;
    const { displayName, ...rest } = change;
    const name = sanitizeDisplayName(displayName);
    return name ? { ...rest, displayName: name } : rest;
}

// Framework-free controller (as the sprint review controller): the React hook below only subscribes to it.
export function createAssigneeCapacityController({ backendUrl = '', fetchCapacity = fetchAssigneeCapacity, saveCapacity = saveAssigneeCapacity, saveDelay = SAVE_DELAY_MS, settleDelay = SETTLE_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let state = EMPTY;
    let current = null, active = false, generation = 0, disposed = false, loadAbort = null, loadTimer = null, refreshing = false;
    const cache = new Map();
    const parked = new Map();
    const csrf = { token: null };
    const listeners = new Set();

    const overlay = queue => (queue ? [...queue.rejected.values(), ...queue.failed.values(), ...queue.inFlight, ...queue.pending.values()] : []);
    const holdsPlanned = changes => [...changes].some(isPlannedChange);
    // The stored team number as shown (own, inherited or pending) for App's capacity maths; a new object only when it changes.
    let plannedSnapshot = null;
    const updatePlannedSnapshot = () => {
        const shown = current && state.document ? effectivePlanned(applyChangesToDocument(state.document, state.changes)) : null;
        const value = plannedNumber(shown);
        const next = value == null ? null : { sprintId: state.sprintId, teamId: state.teamId, value, source: shown.source ?? null };
        if (JSON.stringify(next) !== JSON.stringify(plannedSnapshot)) plannedSnapshot = next;
    };
    // `origin: 'automatic'` marks only the publish of an automatic refresh (the provider keeps the reading position for it).
    const publish = patch => {
        const queue = current;
        state = { ...state, origin: '', ...patch, changes: overlay(queue) };
        if (queue) state.document = queue.document;
        // The card shows the stored number's own save state (the strip may be collapsed).
        state.plannedSave = !queue ? '' : holdsPlanned(queue.rejected.values()) || holdsPlanned(queue.failed.values()) ? 'failed' : holdsPlanned(queue.inFlight) || holdsPlanned(queue.pending.values()) ? 'saving' : '';
        updatePlannedSnapshot();
        listeners.forEach(listener => listener());
    };
    const isCurrent = queue => !disposed && queue === current;
    // Keeps a left scope's queue while it is saving or holds drafts (most recent last, at most five idle ones).
    function park(queue) {
        const key = scopeKeyOf(queue.sprintId, queue.teamId);
        parked.delete(key);
        if (!queue.running && !hasDrafts(queue)) return;
        parked.set(key, queue);
        for (const [oldest, candidate] of parked) {
            if (parked.size <= MAX_PARKED_SCOPES) break;
            if (!candidate.running) parked.delete(oldest);
        }
    }

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
    async function send(queue, chunk, planned) {
        const call = () => saveCapacity(backendUrl, queue.sprintId, { teamId: queue.teamId, ...(planned ? { planned } : {}), changes: chunk }, { csrf });
        try { return await call(); }
        catch (error) {
            if (error.status === 403 && error.code === 'csrf_required') { csrf.token = null; return call(); }
            throw error;
        }
    }

    // The saved document: an own one (no inherited part) that keeps the stored team number the server returned.
    const asDocument = (queue, data) => ({ ...queue.document, teamId: queue.teamId, sprintId: queue.sprintId, revision: data.revision, rows: data.rows || [],
        planned: data.planned !== undefined ? data.planned ?? null : effectivePlanned(queue.document), inherited: null });

    // An unconfirmed PATCH: read the document back and resend only the fields that differ.
    async function recover(queue, chunk, planned) {
        const fresh = await fetchCapacity(backendUrl, queue.sprintId, queue.teamId, {});
        queue.document = { ...fresh };
        const remaining = chunk.map(change => pruneChange(change, fresh)).filter(Boolean);
        const plannedLeft = planned && !isPlannedNoop(effectivePlanned(fresh), planned) ? planned : undefined;
        if (!remaining.length && !plannedLeft) return;
        queue.document = asDocument(queue, await send(queue, remaining, plannedLeft));
    }

    async function pump(queue) {
        if (queue.running || queue.stopped) return;
        queue.running = true;
        queue.timer = null;
        try {
            while (queue.pending.size && !queue.stopped) {
                revive(queue);
                queue.inFlight = [...queue.pending.values()].map(withValidName);
                queue.pending = new Map();
                const changes = queue.inFlight.map(change => pruneChange(change, queue.document)).filter(Boolean);
                if (!changes.length) { queue.inFlight = []; if (isCurrent(queue)) publish(queue.pending.size ? {} : { save: hasFailures(queue) ? 'failed' : state.save === 'saving' ? 'saved' : state.save }); continue; }
                queue.writeEpoch += 1;
                if (isCurrent(queue)) publish({ save: 'saving', error: '' });
                // The stored team number rides with the first chunk as the body's `planned` (a planned-only PATCH sends `changes: []`).
                const planned = changes.find(isPlannedChange)?.planned;
                const batches = chunkChanges(changes.filter(change => !isPlannedChange(change)));
                if (!batches.length) batches.push([]);
                let done = 0;
                try {
                    for (const [index, chunk] of batches.entries()) {
                        const plannedPart = index === 0 ? planned : undefined;
                        try { queue.document = asDocument(queue, await send(queue, chunk, plannedPart)); }
                        catch (error) {
                            if (!error.unconfirmed || isAuthError(error)) throw error;
                            await recover(queue, chunk, plannedPart);
                        }
                        done += 1;
                    }
                    queue.inFlight = [];
                    queue.writeEpoch += 1;
                    cache.set(scopeKeyOf(queue.sprintId, queue.teamId), queue.document);
                    if (isCurrent(queue)) publish({ save: queue.pending.size ? 'saving' : hasFailures(queue) ? 'failed' : 'saved', error: hasFailures(queue) ? queue.error : '', load: 'ready' });
                } catch (error) {
                    queue.writeEpoch += 1;
                    // The failed batch stays visible as drafts and rides along with the next commit or retry.
                    const unsentKeys = new Set(batches.slice(done).flat().map(item => item.assigneeKey));
                    if (planned && done === 0) unsentKeys.add(PLANNED_SLOT);
                    const unsent = queue.inFlight.filter(change => unsentKeys.has(change.assigneeKey));
                    queue.inFlight = [];
                    if (isAuthError(error)) { unsent.forEach(change => mergeInto(queue.pending, change)); queue.stopped = true; if (isCurrent(queue)) publish({ save: 'idle' }); }
                    else {
                        unsent.forEach(change => mergeInto(isRejected(error) ? queue.rejected : queue.failed, change));
                        queue.error = error.message || 'Assignee capacity could not be saved.';
                        if (isCurrent(queue)) publish({ save: 'failed', error: queue.error });
                    }
                    return;
                }
            }
        } finally {
            queue.running = false;
            // A left scope's save finished: keep it only when it failed (its late response never reaches this scope).
            if (!isCurrent(queue)) park(queue);
        }
    }

    const schedule = queue => { if (queue.timer == null && !queue.running) queue.timer = setTimer(() => { queue.timer = null; void pump(queue); }, saveDelay); };
    const flush = queue => { if (!queue) return; if (queue.timer != null) { clearTimer(queue.timer); queue.timer = null; } if (queue.pending.size || queue.failed.size) { revive(queue); void pump(queue); } };

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
            current = null;
            flush(previous);
            if (previous) park(previous);
            generation += 1;
            loadAbort?.abort(); loadAbort = null;
            if (loadTimer != null) { clearTimer(loadTimer); loadTimer = null; }
            // A revisited scope gets its own queue back: its drafts, its failure and any save still running.
            const kept = key ? parked.get(key) : null;
            if (kept) parked.delete(key);
            current = key ? kept || newQueue(String(sprintId), String(teamId), cache.get(key) || null) : null;
            if (current && !current.document) current.document = cache.get(key) || null;
            const cached = current?.document || null;
            const failures = Boolean(current && hasFailures(current));
            state = { ...EMPTY, scopeKey: key, sprintId: String(sprintId || ''), teamId: String(teamId || ''), load: cached ? 'ready' : 'idle', document: cached, capabilities: cached?.capabilities || EMPTY.capabilities,
                save: current?.running ? 'saving' : failures ? 'failed' : 'idle', error: failures ? current.error : '' };
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
            revive(queue);
            changes.forEach(change => { supersede(queue, change); mergeInto(queue.pending, change); });
            const rejected = queue.rejected.size > 0;
            publish({ save: queue.running ? 'saving' : rejected ? 'failed' : state.save === 'failed' ? 'idle' : state.save, error: rejected ? queue.error : '' });
            schedule(queue);
            return true;
        },
        // Records the stored team number ("Team capacity (not in Jira)"): `value` is a validated wire string or null to clear;
        // `source` is `user` (typed) or `jira` (Use ticket value, or after the user's own Jira save). A no-op sends nothing.
        commitPlanned(value, source = 'user') {
            const queue = current;
            if (!queue?.document || !state.capabilities.canSave || queue.stopped) return false;
            const planned = value == null ? { value: null } : { value, source };
            if (isPlannedNoop(effectivePlanned(applyChangesToDocument(queue.document, overlay(queue))), planned)) return true;
            const change = { assigneeKey: PLANNED_SLOT, planned };
            revive(queue);
            supersede(queue, change); mergeInto(queue.pending, change);
            const rejected = queue.rejected.size > 0;
            publish({ save: queue.running ? 'saving' : rejected ? 'failed' : state.save === 'failed' ? 'idle' : state.save, error: rejected ? queue.error : '' });
            schedule(queue);
            return true;
        },
        // Silent database-only mirror of the Jira ticket value after a user-initiated capacity read: only into an existing own
        // document, only when the shown number differs after rounding and is not one the user typed, only while the queue is
        // idle; computed from the post-queue document; a failure is dropped (never `failed`, never replayed). Returns whether sent.
        mirrorPlanned(ticketValue) {
            const queue = current;
            const value = plannedWireValue(ticketValue);
            if (!queue || !active || value == null || !queue.document || !(queue.document.revision > 0) || !state.capabilities.canSave || queue.stopped) return false;
            // A read in flight meanwhile is dropped by its writeEpoch check; the PATCH response is the newer document.
            if (controller.isBusy() || queue.timer != null) return false;
            const stored = queue.document.planned ?? null;
            if (stored?.source === 'user' || samePlannedValue(stored, { value })) return false;
            queue.running = true;
            queue.writeEpoch += 1;
            void (async () => {
                try {
                    queue.document = asDocument(queue, await send(queue, [], { value, source: 'jira', onlyIfSource: [null, 'jira', 'inherited'] }));
                    cache.set(scopeKeyOf(queue.sprintId, queue.teamId), queue.document);
                    if (isCurrent(queue)) publish({});
                } catch { /* dropped silently */ }
                finally {
                    queue.writeEpoch += 1;
                    queue.running = false;
                    if (queue.pending.size && !queue.stopped) schedule(queue);
                    if (!isCurrent(queue)) park(queue);
                }
            })();
            return true;
        },
        getPlannedSnapshot: () => plannedSnapshot,
        // Resends every failed and refused change.
        retry() {
            const queue = current;
            if (!queue || !hasFailures(queue) || queue.stopped) return;
            if (queue.timer != null) { clearTimer(queue.timer); queue.timer = null; }
            revive(queue, { rejected: true });
            publish({ save: 'saving', error: '' });
            void pump(queue);
        },
        // Drops every failed and refused change; the cells show the saved values again.
        discard() {
            const queue = current;
            if (!queue || !hasFailures(queue)) return;
            queue.failed.clear(); queue.rejected.clear(); queue.error = '';
            publish({ save: queue.running ? 'saving' : 'idle', error: '' });
        },
        flush() { flush(current); },
        // Re-reads the document (e.g. after a manual refresh); never while drafts are unsaved.
        reload() { if (current && active) void load(current); },
        // Freshness re-read of the shown document (#251): never while it loads or the queue is busy, and a response that
        // arrives stale or busy is dropped. A failure keeps the held document and raises no loading or error state.
        async refresh({ signal, shouldApply = () => true, automatic = true } = {}) {
            const queue = current;
            if (!queue || !active || !queue.document || state.load === 'loading' || loadAbort || refreshing || controller.isBusy() || signal?.aborted) return { status: 'ignored' };
            const epoch = queue.writeEpoch, thisGeneration = generation;
            const stale = () => !isCurrent(queue) || generation !== thisGeneration || queue.writeEpoch !== epoch || signal?.aborted || !shouldApply() || controller.isBusy();
            refreshing = true;
            let data;
            try { data = await fetchCapacity(backendUrl, queue.sprintId, queue.teamId, { signal }); }
            catch (error) { return { status: isAbort(error) || stale() ? 'ignored' : 'failed' }; }
            finally { refreshing = false; }
            if (stale()) return { status: 'ignored' };
            cache.set(scopeKeyOf(queue.sprintId, queue.teamId), data);
            if (sameDocument(queue.document, data)) return { status: 'ok' };
            queue.document = data;
            publish({ load: 'ready', capabilities: data.capabilities || { canRead: false, canSave: false }, ...(automatic ? { origin: 'automatic' } : {}) });
            return { status: 'ok' };
        },
        // A new auth session: nothing read under the old one is reused; the shown document is held while it is re-read.
        resetSession() {
            cache.clear(); csrf.token = null;
            if (current && active) void load(current);
        },
        isBusy: () => Boolean(current && (current.running || hasDrafts(current))),
        // The provider unmounted: send what is unsaved, keep a busy queue parked, and show nothing (App's stored number too).
        dispose() {
            const queue = current;
            flush(queue);
            current = null;
            if (queue) park(queue);
            generation += 1;
            loadAbort?.abort(); loadAbort = null;
            if (loadTimer != null) { clearTimer(loadTimer); loadTimer = null; }
            state = EMPTY;
            publish({});
            disposed = true;
        },
    };
    return controller;
}

// One controller per backend, held above the provider (#323 B1 design A): the provider drives it and App reads only its
// stored team number through one useSyncExternalStore, so App re-renders only when that number changes.
const controllers = new Map();
export function getAssigneeCapacityController(backendUrl = '') {
    if (!controllers.has(backendUrl)) controllers.set(backendUrl, createAssigneeCapacityController({ backendUrl }));
    return controllers.get(backendUrl);
}

export default function usePlanningAssigneeCapacity({ backendUrl = '', sprintId, teamId, active }) {
    const controller = React.useMemo(() => getAssigneeCapacityController(backendUrl), [backendUrl]);
    const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
    React.useEffect(() => { controller.setScope({ sprintId, teamId, active }); }, [controller, sprintId, teamId, active]);
    React.useEffect(() => () => controller.dispose(), [controller]);
    React.useEffect(() => {
        const reset = () => controller.resetSession();
        window.addEventListener(AUTH_SESSION_REFRESH_EVENT, reset);
        return () => window.removeEventListener(AUTH_SESSION_REFRESH_EVENT, reset);
    }, [controller]);
    return { state, controller };
}
