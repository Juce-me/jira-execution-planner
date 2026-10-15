import { readPendingAuthenticationRequired } from '../api/authRequired.js';

// A deliberate interaction cancels a pending link; scrolling cancels only a running reveal. The
// listeners are document capture-phase listeners rather than window keydown handlers, whose count
// tests/test_auth_isolation_source_guard.js pins over a fixed owner list that excludes shareView/.
const DELIBERATE_EVENTS = ['pointerdown', 'touchstart', 'keydown'];
const SCROLL_EVENTS = ['wheel', 'touchmove'];
// Modifier and lock keys: pressing one is not an interaction.
export const SHARE_VIEW_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS']);

export function armInteractionGuard({ doc = document, onInteraction, isPaused = () => false }) {
    const handle = (event) => {
        if (readPendingAuthenticationRequired()) return;
        if (isPaused() || event.isTrusted === false) return;
        if (event.type === 'keydown' && SHARE_VIEW_MODIFIER_KEYS.has(event.key)) return;
        onInteraction(DELIBERATE_EVENTS.includes(event.type) ? 'deliberate' : 'scroll');
    };
    const types = [...DELIBERATE_EVENTS, ...SCROLL_EVENTS];
    types.forEach(type => doc.addEventListener(type, handle, { capture: true, passive: true }));
    return () => types.forEach(type => doc.removeEventListener(type, handle, { capture: true }));
}
