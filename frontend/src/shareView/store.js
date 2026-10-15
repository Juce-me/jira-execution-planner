// One module-scope store for a shared-link apply. entry.js fills it before React mounts, the apply
// hook drives it through the stages, and useSyncExternalStore reads it. Nothing here persists: a
// reload reads the already stripped URL, finds no link and applies nothing.
import { decodeShareView, stripShareViewParams } from './codec.js';

export const SHARE_VIEW_PHASES = Object.freeze({
    ABSENT: 'absent',
    PENDING: 'pending',
    RUNNING: 'running',
    DONE: 'done',
    PARTIAL: 'partial',
    DROPPED: 'dropped',
    CANCELLED: 'cancelled',
});
const { ABSENT, PENDING, RUNNING, DONE, PARTIAL, DROPPED, CANCELLED } = SHARE_VIEW_PHASES;
const TERMINAL = new Set([DONE, PARTIAL, DROPPED, CANCELLED]);
// Cancelled applies stay silent; done has nothing to report.
const NOTICE_RESULTS = new Set([PARTIAL, DROPPED]);
const ROW_MODES = new Set(['epic', 'story']);

const listeners = new Set();
let scopeCommitted = false;
let planningRowMode = null;

const isActive = (phase) => phase === PENDING || phase === RUNNING;

// hold keeps the ENG task load from fetching the recipient's saved scope while a link is pending
// or running and its own scope has not been committed yet.
function createSnapshot(fields) {
    return Object.freeze({ ...fields, hold: isActive(fields.phase) && !scopeCommitted, terminal: TERMINAL.has(fields.phase) });
}
const emptySnapshot = () => createSnapshot({ phase: ABSENT, stage: null, entry: null, notice: null });
let snapshot = emptySnapshot();

function commit(patch) {
    snapshot = createSnapshot({ ...snapshot, ...patch });
    listeners.forEach((listener) => listener());
}

export const getShareViewSnapshot = () => snapshot;

export function subscribeShareView(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function beginShareViewStage(stage) {
    if (!isActive(snapshot.phase) || (snapshot.phase === RUNNING && snapshot.stage === stage)) return;
    commit({ phase: RUNNING, stage });
}

export function markShareViewScopeCommitted() {
    if (scopeCommitted || !isActive(snapshot.phase)) return;
    scopeCommitted = true;
    commit({});
}

// True only for the call that ended the apply, so the caller reports it exactly once.
export function finishShareView(result, categories = []) {
    if (!TERMINAL.has(result) || !isActive(snapshot.phase)) return false;
    commit({
        phase: result,
        notice: NOTICE_RESULTS.has(result) ? { kind: result, categories: [...new Set(categories)] } : null,
    });
    return true;
}

export function dismissShareViewNotice() {
    if (snapshot.notice) commit({ notice: null });
}

// The Planning table's Epics/Stories mode is local state that resets on every mount, so a link
// seeds the next mount once instead of owning that state.
export function setPendingPlanningRowMode(mode) {
    planningRowMode = ROW_MODES.has(mode) ? mode : null;
}

export function takeInitialPlanningRowMode() {
    const mode = planningRowMode;
    planningRowMode = null;
    return mode;
}

export function resetShareViewForTests() {
    listeners.clear();
    scopeCommitted = false;
    planningRowMode = null;
    snapshot = emptySnapshot();
}

function readSearch(win) {
    try {
        return String(win.location.search || '');
    } catch {
        return '';
    }
}

// Removes the schema keys from the address bar and keeps every other param and the hash. A
// SecurityError or a codec fault leaves the URL as it was; there is nothing safer to fall back to.
function stripSchemaKeys(win, search) {
    try {
        const remaining = stripShareViewParams(search);
        if (remaining === search) return;
        win.history.replaceState(win.history.state, '', `${win.location.pathname}${remaining}${win.location.hash}`);
    } catch {
        // The link stays in the address bar.
    }
}

export function initShareViewFromLocation(win = window) {
    const search = readSearch(win);
    // Strip first: nothing that reads the store or the URL afterwards can see the link.
    stripSchemaKeys(win, search);
    let decoded;
    try {
        decoded = decodeShareView(search);
    } catch {
        decoded = { kind: 'invalid' };
    }
    if (decoded.kind === 'ok') {
        commit({ phase: PENDING, entry: { state: decoded.state, reported: [...decoded.reported] } });
    } else if (decoded.kind === 'newer' || decoded.kind === 'invalid') {
        commit({ phase: DROPPED, notice: { kind: decoded.kind, categories: [] } });
    }
}
