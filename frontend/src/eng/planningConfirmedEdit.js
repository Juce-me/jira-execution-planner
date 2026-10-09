import { measureStickyBottom } from './alertEpicNavigation.js';

// Visual feedback for a confirmed Planning status/priority edit (issue #250): a tint blink on the edited row or card and, only when the
// target would otherwise be off-screen, the smallest scroll that brings it fully into view below the sticky stack. Pure DOM helpers;
// the callers decide WHEN (never while an editor is open, never after the user scrolled since the click).
const REVEAL_MARGIN_PX = 12;
const PLANNING_STICKY_SELECTORS = [
    '.compact-sticky-header.is-visible',
    '.planning-panel.open',
    '.eng-filter-bar',
    '.epic-header',
    '.planning-review-sticky-stack',
    '.planning-review-docked-header',
];
const blinkTimers = new WeakMap();

export const prefersReducedMotion = () => globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// The top and bottom of the area a target must sit inside to count as visible: below the sticky stack and above the docked footer.
function visibleBand() {
    const footer = document.querySelector('.planning-review-docked-footer');
    return {
        top: measureStickyBottom(PLANNING_STICKY_SELECTORS),
        bottom: footer ? footer.getBoundingClientRect().top : window.innerHeight,
    };
}

// The first row whose bottom is below the sticky stack, with its viewport top: the row the reader is looking at. A reorder that moves
// rows above it would shift it, so the caller scrolls by the measured displacement to keep it where it was.
export function viewportAnchor(rows, idOf = row => row.dataset.reviewRow) {
    if (window.scrollY === 0) return null; // like native scroll anchoring, a page at its top stays at its top
    const bandTop = visibleBand().top;
    const row = rows.find(candidate => candidate.getBoundingClientRect().bottom > bandTop + 1);
    return row ? { id: idOf(row), top: row.getBoundingClientRect().top } : null;
}

export function restoreViewportAnchor(rows, anchor, idOf = row => row.dataset.reviewRow) {
    const row = anchor && rows.find(candidate => idOf(candidate) === anchor.id);
    const delta = row ? row.getBoundingClientRect().top - anchor.top : 0;
    if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
}

// Scrolls the page by the minimum distance that makes `element` fully visible; does nothing when it already is. Smooth unless
// reduced motion is requested. Never moves focus. Returns whether it scrolled.
export function revealIfHidden(element, { reducedMotion = prefersReducedMotion() } = {}) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const band = visibleBand();
    let delta = 0;
    if (rect.top < band.top) delta = rect.top - band.top - REVEAL_MARGIN_PX;
    else if (rect.bottom > band.bottom) delta = Math.min(rect.bottom - band.bottom + REVEAL_MARGIN_PX, rect.top - band.top - REVEAL_MARGIN_PX);
    if (!delta) return false;
    window.scrollBy({ top: delta, behavior: reducedMotion ? 'auto' : 'smooth' });
    return true;
}

// Restarts a CSS tint animation on `element` by class, and removes the class once it has run.
export function blinkElement(element, className, durationMs = 1200) {
    if (!element?.isConnected) return;
    window.clearTimeout(blinkTimers.get(element));
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    blinkTimers.set(element, window.setTimeout(() => { element.classList.remove(className); blinkTimers.delete(element); }, durationMs));
}
