import * as React from 'react';
import { fetchAssigneeCapacity, readPlannedNumbers, saveAssigneeCapacity } from '../api/assigneeCapacityApi.js';
import { AUTH_SESSION_REFRESH_EVENT } from '../api/authRefreshContract.js';
import {
    addAssigneeAction, applyChangesToDocument, baseRowsOf, buildChanges, chunkChanges, documentFieldValue, effectivePlanned, isPlannedChange, isPlannedNoop, isValidDisplayName, PLANNED_SLOT, plannedNumber,
    plannedWireValue, pruneChange, samePlannedValue, sanitizeDisplayName,
} from './planningAssigneeCapacityModel.js';

const SAVE_DELAY_MS = 200;
const SETTLE_MS = 250;
const isAuthError = error => error?.name === 'AuthenticationRequiredError';
const isAbort = error => error?.name === 'AbortError';
// The server refused the change itself (shape or size): resending it would fail every later batch too.
const isRejected = error => error?.status === 400 || error?.status === 413;
// One owner per (Sprint, Team) is kept for the page session. Past five, only clean, idle owners are evicted (oldest first;
// an evicted one reloads lazily): an owner that is saving, holds drafts, failed, was refused or was stopped is never evicted.
export const MAX_PARKED_SCOPES = 5;
// At most four assignee-capacity PATCHes are in flight across all owners; the rest wait for a slot.
export const MAX_CONCURRENT_SAVES = 4;
// Undo keeps the last twenty edits of the shown scope (full-row snapshots, or the stored team number before a planned edit).
export const MAX_UNDO = 20;
const ROW_FIELDS = ['capacity', 'vacations', 'notes', 'removed'];
const scopeKeyOf = (sprintId, teamId) => (sprintId && teamId ? `${sprintId}|${teamId}` : '');
const EMPTY = Object.freeze({ scopeKey: '', sprintId: '', teamId: '', load: 'idle', save: 'idle', error: '', origin: '', document: null, changes: [], plannedSave: '', undoCount: 0, undoKept: false, capabilities: { canRead: false, canSave: false } });
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// A re-read that changes none of these leaves the shown document as it is.
const sameDocument = (a, b) => Boolean(a && b) && a.revision === b.revision && sameValue(a.planned, b.planned) && sameValue(a.inherited, b.inherited);
const READ_ERROR = 'Stored Team capacity could not be read.';

// One owner per (Sprint, Team): the unsaved changes, at most one request in flight, the last known document and its read.
// `failed` holds changes whose request failed (they ride along with the next commit); `rejected` holds changes the
// server refused, which wait for Retry or Discard so one bad change cannot fail later batches.
const newQueue = (sprintId, teamId, document) => ({ sprintId, teamId, document, pending: new Map(), inFlight: [], failed: new Map(), rejected: new Map(), error: '', timer: null, running: false, stopped: false, writeEpoch: 0, undo: [], undoKept: false,
    key: scopeKeyOf(sprintId, teamId), load: 'idle', readError: '', loadAbort: null, silent: false, docSeq: 0 });
const hasFailures = queue => Boolean(queue.failed.size || queue.rejected.size);
const hasDrafts = queue => Boolean(queue.pending.size || hasFailures(queue));
const ownerBusy = queue => Boolean(queue && (queue.running || hasDrafts(queue)));
// A stale snapshot must never overwrite newer state: scope changes, failures, Retry, Discard and new reads empty the stack.
const clearUndo = queue => { if (queue) { queue.undo = []; queue.undoKept = false; } };
const recordOf = document => ({ revision: document.revision, planned: document.planned ?? null, inherited: document.inherited ?? null });

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

// A ticket value as a wire string (a number, or a wire string such as a reconcile row's), or null outside 0..10000.
const ticketWireOf = value => (typeof value === 'string' ? (value.trim() ? plannedWireValue(Number(value)) : null) : plannedWireValue(value));

// Framework-free controller (as the sprint review controller): the React hook below only subscribes to it. The strip
// shows one owner (`setScope`); the projection (`setProjectionScope`) holds the stored number of every displayed Team.
export function createAssigneeCapacityController({ backendUrl = '', fetchCapacity = fetchAssigneeCapacity, saveCapacity = saveAssigneeCapacity, readPlanned = readPlannedNumbers, saveDelay = SAVE_DELAY_MS, settleDelay = SETTLE_MS, setTimer = setTimeout, clearTimer = clearTimeout,
    sessionEvents = typeof window !== 'undefined' ? window : null } = {}) {
    let state = EMPTY;
    let current = null, active = false, generation = 0, disposed = false, loadTimer = null, refreshing = false;
    // A 401 locks the app (no in-place unlock): every owner stops, keeps its drafts in memory and sends nothing more.
    let authStopped = false;
    const owners = new Map();
    const listeners = new Set();
    const teamListeners = new Map();
    // The displayed Teams of one Sprint: batch records ({revision, planned, inherited}) by Team.
    let projection = null, projectionGeneration = 0;
    let numbers = null;
    const statuses = new Map();
    let saving = 0;
    const slots = [];
    // Read order: every owner document and batch record gets the next number, so a revision tie (an inherited revision 0)
    // goes to the later read.
    let readSeq = 0;
    const setDocument = (queue, document) => { queue.document = document; queue.docSeq = ++readSeq; };

    const halted = queue => Boolean(queue.stopped || authStopped);
    const canSaveOwner = queue => queue.document?.capabilities?.canSave === true && !halted(queue);
    // A stored-number commit needs the owner's document, except once an editor asked for it (`ensureTeamDocument`) and
    // that read is still running or failed: then it rides on the projection's right for that Sprint (the PATCH carries the
    // whole number), so a typed value is never dropped. A Team nobody opened still refuses.
    const canSavePlannedOwner = queue => (queue.document ? canSaveOwner(queue)
        : (queue.load === 'loading' || queue.load === 'error') && !halted(queue) && projection?.active === true && projection.sprintId === queue.sprintId && projection.teamIds.includes(queue.teamId) && projection.capabilities?.canSave === true);
    const overlay = queue => (queue ? [...queue.rejected.values(), ...queue.failed.values(), ...queue.inFlight, ...queue.pending.values()] : []);
    const holdsPlanned = changes => [...changes].some(isPlannedChange);
    // The projection's batch record for an owner's Team, if the owner is in the projected Sprint.
    const recordFor = queue => (projection && queue && queue.sprintId === projection.sprintId ? projection.byTeam[queue.teamId] : undefined);
    // Of the batch record and the owner's document, the newer one: by revision, then by read order.
    const baseOf = (record, queue) => {
        const document = queue?.document;
        if (!document || !record) return document || record;
        const recordRevision = record.revision || 0, documentRevision = document.revision || 0;
        return recordRevision > documentRevision || (recordRevision === documentRevision && (record.seq || 0) > (queue.docSeq || 0)) ? record : document;
    };
    // An owner whose document a newer, different batch record supersedes (another writer); a clean one is re-read.
    const isStale = queue => {
        const record = recordFor(queue);
        if (!queue?.document || !record || baseOf(record, queue) !== record) return false;
        return (record.revision || 0) > (queue.document.revision || 0) || !sameValue(effectivePlanned(record), effectivePlanned(queue.document));
    };
    const reReadIfStale = queue => { if (isStale(queue) && !queue.running && !queue.pending.size && queue.timer == null) void load(queue); };
    // The stored number as the Team shows it: the newer of record and document, overlaid with the owner's unsaved number.
    const shownPlannedOf = (record, queue) => {
        let shown = effectivePlanned(baseOf(record, queue));
        overlay(queue).forEach(change => { if (isPlannedChange(change)) shown = change.planned?.value == null ? null : change.planned; });
        return shown;
    };
    // The numbers map: every projected Team's shown number. It holds no save or load state, so it keeps its identity until
    // a value or source changes.
    const updateNumbers = () => {
        const p = projection;
        if (!p || !p.active || !p.sprintId) { numbers = null; return; }
        const byTeam = {};
        for (const teamId of p.teamIds) {
            const shown = shownPlannedOf(p.byTeam[teamId], owners.get(scopeKeyOf(p.sprintId, teamId)));
            const value = plannedNumber(shown);
            byTeam[teamId] = Object.freeze({ value, source: value == null ? null : shown.source ?? null });
        }
        const next = { sprintId: p.sprintId, byTeam };
        if (!numbers || JSON.stringify(next) !== JSON.stringify(numbers)) numbers = Object.freeze({ sprintId: p.sprintId, byTeam: Object.freeze(byTeam) });
    };
    // `teamId` limits the Team listeners to that Team's (one owner changed); without it every Team is told.
    const emit = (teamId = null) => {
        updateNumbers();
        listeners.forEach(listener => listener());
        if (teamId != null) teamListeners.get(teamId)?.forEach(listener => listener());
        else teamListeners.forEach(set => set.forEach(listener => listener()));
    };
    // `origin: 'automatic'` marks only the publish of an automatic refresh (the provider keeps the reading position for it).
    const publish = patch => {
        const queue = current;
        state = { ...state, origin: '', ...patch, changes: overlay(queue) };
        if (queue) state.document = queue.document;
        // The card shows the stored number's own save state (the strip may be collapsed).
        state.undoCount = queue ? queue.undo.length : 0;
        state.undoKept = Boolean(queue?.undoKept);
        state.plannedSave = !queue ? '' : holdsPlanned(queue.rejected.values()) || holdsPlanned(queue.failed.values()) ? 'failed' : holdsPlanned(queue.inFlight) || holdsPlanned(queue.pending.values()) ? 'saving' : '';
        emit();
    };
    const isCurrent = queue => !disposed && queue === current;
    // The strip publishes its own state; any other owner's change only reaches the numbers map and the Team listeners.
    const report = (queue, patch) => { if (isCurrent(queue)) publish(typeof patch === 'function' ? patch() : patch); else emit(queue.teamId); };
    const isLive = queue => owners.get(queue.key) === queue;
    const evictable = queue => queue !== current && !ownerBusy(queue) && !queue.stopped && !queue.loadAbort && queue.timer == null;
    // Keeps the evicted document's number as the batch record, so the numbers map is unaffected.
    function drop(queue) {
        const p = projection;
        if (p && queue.document && queue.sprintId === p.sprintId && p.teamIds.includes(queue.teamId)) {
            const record = p.byTeam[queue.teamId];
            if (baseOf(record, queue) === queue.document) p.byTeam[queue.teamId] = { ...recordOf(queue.document), seq: queue.docSeq };
        }
        queue.loadAbort?.abort();
        owners.delete(queue.key);
    }
    // Returns whether an owner was dropped (its Team's status may then come from the projection).
    function evict(keep = null) {
        let dropped = false;
        for (const queue of [...owners.values()]) {
            if (owners.size <= MAX_PARKED_SCOPES) break;
            if (queue !== keep && evictable(queue)) { drop(queue); dropped = true; }
        }
        return dropped;
    }
    // The owner of one scope, most recently used last; `create` adds a missing one.
    function ownerOf(sprintId, teamId, create) {
        const key = scopeKeyOf(sprintId, teamId);
        if (!key) return null;
        let queue = owners.get(key);
        if (queue) { owners.delete(key); owners.set(key, queue); return queue; }
        if (!create) return null;
        queue = newQueue(String(sprintId), String(teamId), null);
        owners.set(key, queue);
        if (evict(queue)) emit();
        return queue;
    }
    // Team commands act on the projection's Sprint (else the strip's); an editor's owner keeps that Sprint and Team.
    const teamOwner = (teamId, create = false) => ownerOf(projection?.sprintId || state.sprintId, teamId == null ? '' : String(teamId), create);

    async function load(queue) {
        if (!isLive(queue) || queue.running || queue.pending.size || queue.loadAbort || authStopped) return;
        const controller = new AbortController();
        queue.loadAbort = controller;
        const epoch = queue.writeEpoch;
        if (!queue.document) { queue.load = 'loading'; queue.readError = ''; report(queue, { load: 'loading', error: '' }); }
        try {
            const data = await fetchCapacity(backendUrl, queue.sprintId, queue.teamId, { signal: controller.signal });
            // A write started or finished meanwhile makes this read stale; the queue's own response wins.
            if (!isLive(queue) || queue.writeEpoch !== epoch || controller.signal.aborted) return;
            if (!sameDocument(queue.document, data)) clearUndo(queue);
            setDocument(queue, data);
            queue.load = 'ready'; queue.readError = '';
            report(queue, () => ({ load: 'ready', capabilities: data.capabilities || { canRead: false, canSave: false }, error: state.save === 'failed' ? state.error : '' }));
        } catch (error) {
            if (isAbort(error) || isAuthError(error) || !isLive(queue)) return;
            if (!queue.document) { queue.load = 'error'; queue.readError = error.message || READ_ERROR; report(queue, { load: 'error' }); }
        } finally {
            if (queue.loadAbort === controller) queue.loadAbort = null;
        }
    }

    const acquire = () => (saving < MAX_CONCURRENT_SAVES ? (saving += 1, Promise.resolve()) : new Promise(resolve => slots.push(resolve)));
    const release = () => { const next = slots.shift(); if (next) next(); else saving -= 1; };
    // Sends one chunk within a PATCH slot; resolves to the saved document or throws. A 403 csrf_required (rejected before
    // dispatch) retries once with a fresh token.
    async function send(queue, chunk, planned) {
        await acquire();
        try {
            if (authStopped) throw Object.assign(new Error('Sign-in required.'), { name: 'AuthenticationRequiredError' });
            const call = () => saveCapacity(backendUrl, queue.sprintId, { teamId: queue.teamId, ...(planned ? { planned } : {}), changes: chunk });
            try { return await call(); }
            catch (error) {
                if (error.status === 403 && error.code === 'csrf_required') return await call();
                throw error;
            }
        } finally { release(); }
    }

    // The saved document: an own one (no inherited part) that keeps the stored team number the server returned.
    // Without a document of its own (a commit on the projection's right), the saved one takes the projection's capabilities.
    const asDocument = (queue, data) => ({ ...queue.document, capabilities: queue.document?.capabilities || projection?.capabilities || { canRead: false, canSave: false },
        teamId: queue.teamId, sprintId: queue.sprintId, revision: data.revision, rows: data.rows || [],
        planned: data.planned !== undefined ? data.planned ?? null : effectivePlanned(queue.document), inherited: null });

    // An unconfirmed PATCH: read the document back and resend only the fields that differ.
    async function recover(queue, chunk, planned) {
        const fresh = await fetchCapacity(backendUrl, queue.sprintId, queue.teamId, {});
        setDocument(queue, { ...fresh });
        const remaining = chunk.map(change => pruneChange(change, fresh)).filter(Boolean);
        const plannedLeft = planned && !isPlannedNoop(effectivePlanned(fresh), planned) ? planned : undefined;
        if (!remaining.length && !plannedLeft) return;
        setDocument(queue, asDocument(queue, await send(queue, remaining, plannedLeft)));
    }

    async function pump(queue) {
        if (queue.running || halted(queue)) return;
        queue.running = true;
        queue.timer = null;
        try {
            while (queue.pending.size && !halted(queue)) {
                revive(queue);
                queue.inFlight = [...queue.pending.values()].map(withValidName);
                queue.pending = new Map();
                // The stored number is compared with what the Team shows: a newer batch record beats a stale document.
                const changes = queue.inFlight.map(change => pruneChange(change, isPlannedChange(change) ? baseOf(recordFor(queue), queue) : queue.document)).filter(Boolean);
                if (!changes.length) { queue.inFlight = []; report(queue, () => (queue.pending.size ? {} : { save: hasFailures(queue) ? 'failed' : state.save === 'saving' ? 'saved' : state.save })); continue; }
                queue.writeEpoch += 1;
                report(queue, { save: 'saving', error: '' });
                // The stored team number rides with the first chunk as the body's `planned` (a planned-only PATCH sends `changes: []`).
                const planned = changes.find(isPlannedChange)?.planned;
                const batches = chunkChanges(changes.filter(change => !isPlannedChange(change)));
                if (!batches.length) batches.push([]);
                let done = 0;
                try {
                    for (const [index, chunk] of batches.entries()) {
                        const plannedPart = index === 0 ? planned : undefined;
                        try { setDocument(queue, asDocument(queue, await send(queue, chunk, plannedPart))); }
                        catch (error) {
                            if (!error.unconfirmed || isAuthError(error)) throw error;
                            await recover(queue, chunk, plannedPart);
                        }
                        done += 1;
                    }
                    queue.inFlight = [];
                    queue.writeEpoch += 1;
                    queue.load = 'ready';
                    report(queue, () => ({ save: queue.pending.size ? 'saving' : hasFailures(queue) ? 'failed' : 'saved', error: hasFailures(queue) ? queue.error : '', load: 'ready' }));
                } catch (error) {
                    queue.writeEpoch += 1;
                    clearUndo(queue);
                    // The failed batch stays visible as drafts and rides along with the next commit or retry.
                    const unsentKeys = new Set(batches.slice(done).flat().map(item => item.assigneeKey));
                    if (planned && done === 0) unsentKeys.add(PLANNED_SLOT);
                    const unsent = queue.inFlight.filter(change => unsentKeys.has(change.assigneeKey));
                    queue.inFlight = [];
                    if (isAuthError(error)) {
                        unsent.forEach(change => mergeInto(queue.pending, change));
                        queue.stopped = true;
                        // The stop is controller-wide: the first 401 changes every Team's status, so every Team is told.
                        const first = !authStopped;
                        authStopped = true;
                        report(queue, { save: 'idle' });
                        if (first) emit();
                    }
                    else {
                        unsent.forEach(change => mergeInto(isRejected(error) ? queue.rejected : queue.failed, change));
                        queue.error = error.message || 'Assignee capacity could not be saved.';
                        report(queue, { save: 'failed', error: queue.error });
                    }
                    return;
                }
            }
        } finally {
            queue.running = false;
            // A left scope's save finished: its owner stays (a failure shows on return); clean idle ones may now be evicted.
            if (!isCurrent(queue)) emit(evict() ? null : queue.teamId);
        }
    }

    // Queues validated changes as one commit (an undo is an ordinary edit); `record` is the undo entry it pushes, if any.
    function enqueue(queue, changes, record) {
        revive(queue);
        changes.forEach(change => { supersede(queue, change); mergeInto(queue.pending, change); });
        if (record) { queue.undo.push(record); if (queue.undo.length > MAX_UNDO) queue.undo.shift(); queue.undoKept = false; }
        const rejected = queue.rejected.size > 0;
        report(queue, () => ({ save: queue.running ? 'saving' : rejected ? 'failed' : state.save === 'failed' ? 'idle' : state.save, error: rejected ? queue.error : '' }));
        schedule(queue);
    }
    // The full row as the shown document holds it (inherited rows hold Capacity only); `inheriting` marks a snapshot
    // taken before the first write of an inherited Sprint, which an undo cannot bring back.
    const rowSnapshot = (queue, shownDocument, key, extra = {}) => ({
        type: 'row', key, values: Object.fromEntries(ROW_FIELDS.map(field => [field, documentFieldValue(shownDocument, key, field)])),
        inheriting: !(queue.document.revision > 0) && !overlay(queue).length, ...extra,
    });

    const schedule = queue => { if (queue.timer == null && !queue.running) queue.timer = setTimer(() => { queue.timer = null; void pump(queue); }, saveDelay); };
    const flush = queue => { if (!queue) return; if (queue.timer != null) { clearTimer(queue.timer); queue.timer = null; } if (queue.pending.size || queue.failed.size) { revive(queue); void pump(queue); } };

    // The stored team number ("Team capacity (not in Jira)"): `value` is a validated wire string or null to clear; `source`
    // is `user` (typed) or `jira` (after the user's own Jira save). A no-op sends nothing.
    function commitPlannedTo(queue, value, source) {
        if (!queue || !canSavePlannedOwner(queue)) return false;
        const planned = value == null ? { value: null } : { value, source };
        const previous = shownPlannedOf(recordFor(queue), queue);
        if (isPlannedNoop(previous, planned)) return true;
        enqueue(queue, [{ assigneeKey: PLANNED_SLOT, planned }], { type: 'planned', planned: previous, inheriting: !(queue.document?.revision > 0) && !overlay(queue).length });
        return true;
    }
    // Silent database-only mirror of the Jira ticket value after a user-initiated capacity read: only into an existing own
    // document, only when the shown number differs after rounding and is not one the user typed, only while the owner is
    // idle; computed from the post-queue document; a failure is dropped (never `failed`, never replayed). Returns whether sent.
    function mirrorTo(queue, ticketValue) {
        const value = ticketWireOf(ticketValue);
        if (!queue || value == null || !queue.document || !(queue.document.revision > 0) || !canSaveOwner(queue)) return false;
        // A read in flight meanwhile is dropped by its writeEpoch check; the PATCH response is the newer document.
        if (ownerBusy(queue) || queue.timer != null) return false;
        const stored = queue.document.planned ?? null;
        if (stored?.source === 'user' || samePlannedValue(stored, { value })) return false;
        queue.running = true;
        queue.silent = true;
        queue.writeEpoch += 1;
        void (async () => {
            try {
                setDocument(queue, asDocument(queue, await send(queue, [], { value, source: 'jira', onlyIfSource: [null, 'jira', 'inherited'] })));
                report(queue, {});
            } catch { clearUndo(queue); report(queue, {}); /* otherwise dropped silently */ }
            finally {
                queue.writeEpoch += 1;
                queue.running = false;
                queue.silent = false;
                if (queue.pending.size && !halted(queue)) schedule(queue);
                if (!isCurrent(queue)) emit(evict() ? null : queue.teamId);
            }
        })();
        return true;
    }
    // Resends every failed and refused change.
    function retryOwner(queue) {
        if (!queue || !hasFailures(queue) || halted(queue)) return;
        if (queue.timer != null) { clearTimer(queue.timer); queue.timer = null; }
        clearUndo(queue);
        revive(queue, { rejected: true });
        report(queue, { save: 'saving', error: '' });
        void pump(queue);
    }

    // A Team's status for its card: the owner's read and save, else the projection's read of the Team. `canSave` is null
    // while unknown (no full document and no batch capabilities yet), never a "cannot save" guess.
    function teamStatus(teamId) {
        const p = projection;
        // A plain lookup: reading a status never changes which owner is most recently used.
        const queue = owners.get(scopeKeyOf(p?.sprintId || state.sprintId, teamId));
        let load = 'idle', readError = '', canSave = null;
        if (queue && (queue.document || queue.load !== 'idle')) {
            load = queue.document ? 'ready' : queue.load;
            readError = load === 'error' ? queue.readError : '';
        } else if (p && p.active && p.teamIds.includes(teamId)) {
            if (p.failed.has(teamId)) { load = 'error'; readError = READ_ERROR; }
            else if (p.load === 'error') { load = 'error'; readError = p.error; }
            else load = teamId in p.byTeam || p.load === 'ready' ? 'ready' : p.load;
        }
        if (queue?.document) canSave = canSaveOwner(queue);
        else if (queue && halted(queue)) canSave = false;
        else if (p?.capabilities) canSave = p.capabilities.canSave === true && !authStopped;
        let save = 'idle';
        if (queue) {
            if (queue.rejected.size) save = 'rejected';
            else if (queue.failed.size) save = 'failed';
            else if (!halted(queue) && ((queue.running && !queue.silent) || queue.pending.size || queue.inFlight.length)) save = 'saving';
        }
        const error = save === 'rejected' || save === 'failed' ? queue.error : '';
        // The stored-number slot alone (the cards' Retry and Discard); `save` covers the whole owner, person rows included.
        let plannedSave = 'idle';
        if (queue) {
            if (holdsPlanned(queue.rejected.values())) plannedSave = 'rejected';
            else if (holdsPlanned(queue.failed.values())) plannedSave = 'failed';
            else if (!halted(queue) && (holdsPlanned(queue.inFlight) || holdsPlanned(queue.pending.values()))) plannedSave = 'saving';
        }
        return { load, readError, save, error, canSave, plannedSave };
    }

    // The batch read of the projected Teams (more than one: one Team derives from its full GET). A rejected read is a
    // projection error that keeps the previous numbers; an automatic one raises no error state over held records.
    async function readProjection({ automatic = false, signal, shouldApply = () => true } = {}) {
        const p = projection;
        if (!p || !p.active || p.teamIds.length < 2 || p.abort || authStopped || signal?.aborted) return { status: 'ignored' };
        const thisGeneration = projectionGeneration;
        const abort = new AbortController();
        p.abort = abort;
        const onAbort = () => abort.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        const stale = () => projection !== p || projectionGeneration !== thisGeneration || abort.signal.aborted || !shouldApply();
        if (!Object.keys(p.byTeam).length && p.load !== 'error') { p.load = 'loading'; emit(); }
        let data;
        try { data = await readPlanned(backendUrl, p.sprintId, p.teamIds, { signal: abort.signal }); }
        catch (error) {
            if (isAbort(error) || isAuthError(error) || stale()) return { status: 'ignored' };
            if (!automatic || !Object.keys(p.byTeam).length) { p.load = 'error'; p.error = error.message || READ_ERROR; emit(); }
            return { status: 'failed' };
        } finally {
            if (p.abort === abort) p.abort = null;
            signal?.removeEventListener('abort', onAbort);
        }
        if (stale()) return { status: 'ignored' };
        Object.entries(data.byTeam || {}).forEach(([teamId, record]) => {
            // A record never replaces a newer one this page already holds (an owner's own save, say); a tie goes to this read.
            if (p.teamIds.includes(teamId) && (record.revision || 0) >= (p.byTeam[teamId]?.revision || 0)) p.byTeam[teamId] = { ...record, seq: ++readSeq };
        });
        p.failed = new Set((data.failedTeamIds || []).map(String));
        if (data.capabilities) p.capabilities = data.capabilities;
        p.load = 'ready'; p.error = '';
        emit();
        // Owners a newer record supersedes are re-read when clean (a dirty one keeps its drafts over the record).
        owners.forEach(queue => { if (queue.sprintId === p.sprintId && p.teamIds.includes(queue.teamId)) reReadIfStale(queue); });
        return { status: 'ok' };
    }
    function startProjection() {
        const p = projection;
        if (!p?.active) return;
        if (p.teamIds.length > 1) { void readProjection(); return; }
        // One Team: its full GET (the strip's own when it shows that Team).
        const queue = ownerOf(p.sprintId, p.teamIds[0], true);
        if (queue !== current && !queue.document) void load(queue);
    }

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
            clearUndo(previous);
            flush(previous);
            generation += 1;
            if (loadTimer != null) { clearTimer(loadTimer); loadTimer = null; }
            // A revisited scope gets its own owner back: its document, its drafts, its failure and any save still running.
            current = key ? ownerOf(String(sprintId), String(teamId), true) : null;
            clearUndo(current);
            evict();
            const cached = current?.document || null;
            const failures = Boolean(current && hasFailures(current));
            state = { ...EMPTY, scopeKey: key, sprintId: String(sprintId || ''), teamId: String(teamId || ''), load: cached ? 'ready' : 'idle', document: cached, capabilities: cached?.capabilities || EMPTY.capabilities,
                save: current?.running && !current.silent ? 'saving' : failures ? 'failed' : 'idle', error: failures ? current.error : '' };
            publish({});
            // A held document shows at once and is re-read silently after the settle delay, unless a batch record vouches
            // for it (not older and not different): then it is reused without a second GET (a card edit loaded it, say).
            if (current && active && (!current.document || !recordFor(current) || isStale(current))) {
                const queue = current;
                if (previous) loadTimer = setTimer(() => { loadTimer = null; void load(queue); }, settleDelay);
                else void load(queue);
            }
        },
        // The displayed Teams of one Sprint whose stored numbers App reads (`getPlannedNumbers`). Called by the provider.
        setProjectionScope({ sprintId, teamIds, active: nextActive }) {
            disposed = false;
            const sprint = sprintId ? String(sprintId) : '';
            const ids = [...new Set([...(teamIds || [])].map(String).filter(Boolean))];
            const isActive = Boolean(nextActive && sprint && ids.length);
            const key = JSON.stringify([sprint, ids]);
            if (projection?.key === key) {
                const was = projection.active;
                projection.active = isActive;
                if (isActive && !was) startProjection();
                emit();
                return;
            }
            const previous = projection;
            previous?.abort?.abort();
            projectionGeneration += 1;
            const sameSprint = previous?.sprintId === sprint;
            projection = { key, sprintId: sprint, teamIds: ids, active: isActive, load: 'idle', error: '', failed: new Set(), abort: null,
                capabilities: sameSprint ? previous.capabilities : null,
                byTeam: sameSprint ? Object.fromEntries(Object.entries(previous.byTeam).filter(([teamId]) => ids.includes(teamId))) : {} };
            startProjection();
            emit();
        },
        // Re-reads the projected Teams' stored numbers (the header Refresh or the automatic follow-up, #251).
        refreshProjection: ({ automatic = true, signal, shouldApply = () => true } = {}) => readProjection({ automatic, signal, shouldApply }),
        getPlannedNumbers: () => numbers,
        getTeamStatus(teamId) {
            const id = String(teamId);
            const next = teamStatus(id);
            const previous = statuses.get(id);
            if (previous && Object.keys(next).every(field => previous[field] === next[field])) return previous;
            const frozen = Object.freeze(next);
            statuses.set(id, frozen);
            return frozen;
        },
        subscribeTeam(teamId, listener) {
            const id = String(teamId);
            if (!teamListeners.has(id)) teamListeners.set(id, new Set());
            teamListeners.get(id).add(listener);
            return () => { teamListeners.get(id)?.delete(listener); if (!teamListeners.get(id)?.size) teamListeners.delete(id); };
        },
        // Per-Team commands (the cards): each acts on that Team's owner in the projection's Sprint.
        commitTeamPlanned: (teamId, value, source = 'user') => commitPlannedTo(teamOwner(teamId), value, source),
        mirrorTeamPlanned: (teamId, ticketWire) => Boolean(projection?.active) && mirrorTo(teamOwner(teamId), ticketWire),
        retryTeam(teamId) { retryOwner(teamOwner(teamId)); },
        // Drops only that Team's failed or refused stored-number draft; person-row drafts stay.
        discardTeamPlanned(teamId) {
            const queue = teamOwner(teamId);
            if (!queue || !(queue.failed.has(PLANNED_SLOT) || queue.rejected.has(PLANNED_SLOT))) return;
            queue.failed.delete(PLANNED_SLOT); queue.rejected.delete(PLANNED_SLOT); clearUndo(queue);
            if (!hasFailures(queue)) queue.error = '';
            report(queue, () => ({ save: queue.running ? 'saving' : hasFailures(queue) ? 'failed' : 'idle', error: hasFailures(queue) ? queue.error : '' }));
        },
        // Loads the Team's full document once (a card editor needs it); a loaded or loading owner is reused.
        ensureTeamDocument(teamId) {
            if (disposed || authStopped) return;
            const queue = teamOwner(teamId, true);
            if (queue && !queue.document) void load(queue);
            else reReadIfStale(queue);
        },
        flushTeam(teamId) { flush(teamOwner(teamId)); },
        // Records one validated commit; returns false when it cannot be saved here. `buildShown(document)` gives
        // the rows as displayed ({ rows, removedKeys }) so a commit equal to what is shown sends nothing.
        commit(commit, buildShown) {
            const queue = current;
            if (!queue?.document || !state.capabilities.canSave || halted(queue)) return false;
            const shownDocument = applyChangesToDocument(queue.document, overlay(queue));
            const shown = buildShown(shownDocument);
            const changes = buildChanges([commit], shown.rows, shown.removedKeys);
            if (!changes.length) return true;
            enqueue(queue, changes, rowSnapshot(queue, shownDocument, commit.key));
            return true;
        },
        // Add assignee: `person` is a search result {accountId, displayName}. Returns the action taken ('exists', 'restore',
        // 'add') or false when it cannot be saved here. A restore is the ordinary `removed: false` commit.
        addPerson(person, buildShown) {
            const queue = current;
            if (!queue?.document || !state.capabilities.canSave || halted(queue)) return false;
            const shownDocument = applyChangesToDocument(queue.document, overlay(queue));
            const shown = buildShown(shownDocument);
            const action = addAssigneeAction(person, shown.rows, shown.removedKeys);
            if (!action) return false;
            if (action.type === 'exists') return 'exists';
            if (action.type === 'restore') return controller.commit({ key: action.key, field: 'removed', value: false }, buildShown) && 'restore';
            // Without a delete route, undoing an Add assignee removes the person again (unless it was never sent).
            const record = rowSnapshot(queue, shownDocument, action.key, { added: true });
            record.values.removed = true;
            enqueue(queue, [action.change], record);
            return 'add';
        },
        // The strip Team's stored number (see commitPlannedTo).
        commitPlanned(value, source = 'user') {
            if (!state.capabilities.canSave) return false;
            return commitPlannedTo(current, value, source);
        },
        // Undo: re-commits the newest snapshot through the same queue as an ordinary edit (a field already equal sends nothing).
        // Returns whether an entry was taken. Undo of the first edit of an inherited Sprint keeps the Sprint's own copy with
        // the inherited values (`undoKept`), unless that edit was never sent.
        undo() {
            const queue = current;
            if (!queue?.document || !state.capabilities.canSave || halted(queue) || !queue.undo.length) return false;
            const entry = queue.undo.pop();
            const shownDocument = applyChangesToDocument(queue.document, overlay(queue));
            const written = queue.document.revision > 0 || queue.running || queue.inFlight.length > 0;
            let changes;
            if (entry.type === 'planned') {
                // `inherited` is server-only: the restored number is saved as this Sprint's own (typed) one.
                const planned = entry.planned?.value == null ? { value: null } : { value: entry.planned.value, source: entry.planned.source === 'jira' ? 'jira' : 'user' };
                changes = isPlannedNoop(effectivePlanned(shownDocument), planned) ? [] : [{ assigneeKey: PLANNED_SLOT, planned }];
            } else if (entry.added && queue.pending.has(entry.key) && !baseRowsOf(queue.document).some(row => row.assigneeKey === entry.key)
                && !queue.inFlight.some(change => change.assigneeKey === entry.key) && !queue.failed.has(entry.key) && !queue.rejected.has(entry.key)) {
                // An Add assignee not sent yet is simply dropped.
                queue.pending.delete(entry.key);
                changes = [];
            } else {
                const change = pruneChange({ assigneeKey: entry.key, ...entry.values }, shownDocument);
                changes = change ? [change] : [];
            }
            if (changes.length) enqueue(queue, changes, null);
            queue.undoKept = Boolean(entry.inheriting && written);
            publish({});
            return true;
        },
        // The strip Team's mirror (see mirrorTo).
        mirrorPlanned(ticketValue) { return active && Boolean(current) && state.capabilities.canSave && mirrorTo(current, ticketValue); },
        retry() { retryOwner(current); },
        // Drops every failed and refused change; the cells show the saved values again.
        discard() {
            const queue = current;
            if (!queue || !hasFailures(queue)) return;
            queue.failed.clear(); queue.rejected.clear(); queue.error = ''; clearUndo(queue);
            publish({ save: queue.running ? 'saving' : 'idle', error: '' });
        },
        flush() { flush(current); },
        // Re-reads the document (e.g. after a manual refresh); never while drafts are unsaved.
        reload() { if (current && active) void load(current); },
        // Freshness re-read of the shown document (#251): never while it loads or the owner is busy, and a response that
        // arrives stale or busy is dropped. A failure keeps the held document and raises no loading or error state.
        async refresh({ signal, shouldApply = () => true, automatic = true } = {}) {
            const queue = current;
            if (!queue || !active || !queue.document || state.load === 'loading' || queue.loadAbort || refreshing || ownerBusy(queue) || signal?.aborted) return { status: 'ignored' };
            const epoch = queue.writeEpoch, thisGeneration = generation;
            const stale = () => !isCurrent(queue) || generation !== thisGeneration || queue.writeEpoch !== epoch || signal?.aborted || !shouldApply() || ownerBusy(queue);
            refreshing = true;
            let data;
            try { data = await fetchCapacity(backendUrl, queue.sprintId, queue.teamId, { signal }); }
            catch (error) { return { status: isAbort(error) || stale() ? 'ignored' : 'failed' }; }
            finally { refreshing = false; }
            if (stale()) return { status: 'ignored' };
            if (sameDocument(queue.document, data)) return { status: 'ok' };
            clearUndo(queue);
            setDocument(queue, data);
            publish({ load: 'ready', capabilities: data.capabilities || { canRead: false, canSave: false }, ...(automatic ? { origin: 'automatic' } : {}) });
            return { status: 'ok' };
        },
        // A new auth session: nothing read under the old one is reused (clean owners are dropped; dirty ones keep their
        // drafts), undo history is cleared, and the shown document and the numbers are held while they are re-read.
        resetSession() {
            owners.forEach(clearUndo);
            [...owners.values()].forEach(queue => { if (queue !== current && !ownerBusy(queue) && !queue.stopped) drop(queue); });
            if (current) { current.loadAbort?.abort(); current.loadAbort = null; publish({}); }
            if (current && active) void load(current);
            if (projection?.active) { projection.abort?.abort(); projection.abort = null; projectionGeneration += 1; startProjection(); }
            emit();
        },
        isBusy: () => [...owners.values()].some(ownerBusy),
        // The provider unmounted: send what is unsaved, keep busy owners, and show nothing (App's stored numbers too).
        dispose() {
            owners.forEach(flush);
            owners.forEach(queue => { queue.loadAbort?.abort(); queue.loadAbort = null; if (!queue.document && queue.load === 'loading') queue.load = 'idle'; });
            current = null;
            generation += 1;
            if (loadTimer != null) { clearTimer(loadTimer); loadTimer = null; }
            projection?.abort?.abort();
            projection = null;
            projectionGeneration += 1;
            state = EMPTY;
            publish({});
            disposed = true;
        },
    };
    // A new auth session (AUTH_SESSION_REFRESH_EVENT), for the page's whole life: the controller outlives the provider.
    sessionEvents?.addEventListener(AUTH_SESSION_REFRESH_EVENT, () => controller.resetSession());
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
    return { state, controller };
}
