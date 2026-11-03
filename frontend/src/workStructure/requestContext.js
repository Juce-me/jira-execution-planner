// The accepted work-configuration context shared by every scoped request builder.
//
// The dashboard publishes the immutable context once per change. Builders stamp it into the query/body
// at call time, register the request, and a completion that outlives its context is dropped as an abort:
// the same signal callers already treat as "superseded, do nothing".

import { applyContextToParams, contextBody, contextKey, writeStampOf } from './configurationContext.js';

let active = null;
const inflight = new Set();
const listeners = new Set();

// Callers already treat `name === 'AbortError'` as "superseded, do nothing".
const staleError = () => Object.assign(new Error('The work configuration changed.'), {
    name: 'AbortError', code: 'configuration_context_changed',
});

export const getActiveWorkContext = () => active;

// Readers that render from the context (stats, EPM) re-run when it changes.
export function subscribeActiveWorkContext(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function setActiveWorkContext(context) {
    const next = context || null;
    if (contextKey(next) === contextKey(active)) { active = next; return active; }
    active = next;
    for (const entry of [...inflight]) {
        if (contextKey(entry.context) !== contextKey(active)) entry.controller.abort(staleError());
    }
    listeners.forEach(listener => listener());
    return active;
}

export const stampParams = (params, options = {}) => applyContextToParams(params, active, options);
export const stampBody = body => (active ? { ...body, ...contextBody(active) } : body);

// Own-key Jira writes and review calls carry the nested stamp; unpromoted (no active context) bodies are untouched.
export const stampWriteBody = body => (active ? { ...body, configuration: writeStampOf(active) } : body);
// GET write-options routes name the stamp by query; their digest is optional server-side but always sent.
export const stampWriteParams = params => applyContextToParams(params, active);

// A write rejected as `configuration_scope_changed` asks the dashboard to re-read the configuration summaries. The
// rejected draft stays where it is and is never replayed here; the user repeats the action under the new context.
const staleListeners = new Set();
export function onWorkContextStale(listener) {
    staleListeners.add(listener);
    return () => staleListeners.delete(listener);
}
export function reportWorkContextStale() {
    for (const listener of [...staleListeners]) listener(active);
}
export const isStaleWorkContextError = error => error?.code === 'configuration_scope_changed';

// Runs `start(signal)` under the current context. The caller's own signal still aborts it.
export async function runInWorkContext(init = {}, start) {
    const context = active;
    if (!context) return start(init);
    const controller = new AbortController();
    const outer = init.signal;
    const relay = () => controller.abort(outer.reason);
    if (outer) {
        if (outer.aborted) controller.abort(outer.reason);
        else outer.addEventListener('abort', relay, { once: true });
    }
    const entry = { context, controller };
    inflight.add(entry);
    try {
        const response = await start({ ...init, signal: controller.signal });
        if (contextKey(context) !== contextKey(active)) throw staleError();
        return response;
    } finally {
        inflight.delete(entry);
        outer?.removeEventListener('abort', relay);
    }
}
