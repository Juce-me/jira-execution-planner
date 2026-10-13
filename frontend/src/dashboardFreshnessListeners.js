import { AUTH_LONG_ABSENCE_EVENT, AUTH_LONG_ABSENCE_SLOT, AUTH_SESSION_REFRESH_EVENT, AUTH_FOCUS_REFRESH_STATE_EVENT,
    CONNECTION_UNAVAILABLE_EVENT, CONNECTION_AVAILABLE_EVENT, LONG_ABSENCE_MS } from './api/authRefreshContract.js';
import { AUTH_REQUIRED_EVENT } from './api/authRequired.js';

export function installFreshnessListeners(win, doc, controller) {
    const listeners = [];
    let disposed = false;
    const listen = (target, type, handler) => {
        target.addEventListener(type, handler);
        listeners.push(() => target.removeEventListener(type, handler));
    };
    // HTTP already publishes terminal auth; event consumers must own rejection.
    const consume = result => { void Promise.resolve(result).catch(() => {}); };
    const update = () => consume(controller.update());
    listen(win, 'focus', update);
    listen(win, 'blur', update);
    listen(doc, 'visibilitychange', update);
    listen(win, 'pageshow', event => {
        if (event.persisted) {
            if (controller.shouldCheckBfcache?.() === false) return;
            consume(controller.request({ reason: 'bfcache' }));
        }
    });
    const longReturn = event => {
        const detail = event.detail || {};
        if (!(detail.unfocusedMs > LONG_ABSENCE_MS)) return;
        const observedAtMs = Number.isFinite(detail.observedAtMs) ? detail.observedAtMs : (controller.now?.() ?? Date.now());
        const absenceStartedAtMs = Number.isFinite(detail.absenceStartedAtMs) ? detail.absenceStartedAtMs : observedAtMs - detail.unfocusedMs;
        consume(controller.request({ reason: 'long_return', absenceStartedAtMs }));
        // StrictMode can dispose this owner before the next setup claims the intent.
        void Promise.resolve().then(() => { if (!disposed && win[AUTH_LONG_ABSENCE_SLOT] === detail) delete win[AUTH_LONG_ABSENCE_SLOT]; });
    };
    listen(win, AUTH_LONG_ABSENCE_EVENT, longReturn);
    listen(win, AUTH_FOCUS_REFRESH_STATE_EVENT, event => { controller.onAuthActivity?.(event.detail || {}); update(); });
    listen(win, AUTH_SESSION_REFRESH_EVENT, () => { controller.onSessionRefresh?.(); update(); });
    listen(win, AUTH_REQUIRED_EVENT, () => { delete win[AUTH_LONG_ABSENCE_SLOT]; controller.onTerminalAuth?.(); update(); });
    listen(win, CONNECTION_UNAVAILABLE_EVENT, () => { controller.onConnectionChange?.(true); update(); });
    listen(win, CONNECTION_AVAILABLE_EVENT, () => { controller.onConnectionChange?.(false); update(); });
    if (win[AUTH_LONG_ABSENCE_SLOT]) longReturn({ detail: win[AUTH_LONG_ABSENCE_SLOT] });
    return { dispose: () => { disposed = true; for (const remove of listeners.splice(0)) remove(); } };
}
