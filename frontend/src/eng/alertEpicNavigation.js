const requirementHighlightTimers = new WeakMap();

function normalizedIdentityPart(value) {
    return encodeURIComponent(String(value ?? '').trim());
}

export function buildStoryRequirementId({ groupId, sprintId, epicKey, teamId } = {}) {
    return ['story-required', groupId, sprintId, epicKey, teamId]
        .map(normalizedIdentityPart)
        .join('::');
}

export function buildStoryRequirementDismissalId(identity = {}) {
    return buildStoryRequirementId(identity);
}

function findStoryRequirement(requirementId) {
    const normalizedId = String(requirementId || '');
    return Array.from(document.querySelectorAll('[data-story-requirement-id]'))
        .find(element => element.getAttribute('data-story-requirement-id') === normalizedId) || null;
}

export const STICKY_STACK_SELECTORS = [
    '.compact-sticky-header.is-visible',
    '.planning-panel.open',
    '.eng-filter-bar',
    '[data-alert-pin]',
    '.epic-header',
];

// Bottom edge of the sticky stack (compact header, Planning panel, filter bar, pinned alert, Epic header, plus any extra tiers the caller names).
export function measureStickyBottom(selectors = STICKY_STACK_SELECTORS) {
    return selectors.reduce((bottom, selector) => {
        document.querySelectorAll(selector).forEach((element) => {
            const style = window.getComputedStyle(element);
            if (style.position !== 'sticky' && style.position !== 'fixed') return;
            const rect = element.getBoundingClientRect();
            if (rect.top <= Math.max(1, Number.parseFloat(style.top) || 0) + 1) {
                bottom = Math.max(bottom, rect.bottom);
            }
        });
        return bottom;
    }, 0);
}

// Where the page scrolls to show a Story requirement with its Epic: the Epic's top 12px under the sticky stack when the whole Epic fits below
// the stack, otherwise the card centred in that space (its top under the stack when the card alone is taller); always within the scroll range.
// Rects are viewport-relative. A card outside an Epic block has no epicTop/epicHeight and keeps the centred landing.
export function storyRequirementScrollTop({ scrollY, stackBottom, viewportHeight, maxScroll, epicTop, epicHeight, cardTop, cardHeight }) {
    const guard = stackBottom + 12;
    const available = Math.max(0, viewportHeight - guard);
    const desired = epicHeight <= available
        ? scrollY + epicTop - guard
        : scrollY + cardTop - guard - Math.max(0, (available - cardHeight) / 2);
    return Math.min(Math.max(0, maxScroll), Math.max(0, desired));
}

// The stack the Epic lands under: every tier but Epic headers (the target's own header pins there), plus the sticky filter bar, which the
// default list names as `.eng-filter-bar`, a class no element carries.
function revealStackBottom() {
    return measureStickyBottom([...STICKY_STACK_SELECTORS.filter(selector => selector !== '.epic-header'), '.filterbar-wrap']);
}

// The Epic block is never sticky, so its rect is the Epic's natural place; its header (the first child) starts inside the top border and padding.
function requirementScrollTop(element) {
    const card = element.getBoundingClientRect();
    const block = element.closest('.epic-block');
    const blockRect = block?.getBoundingClientRect();
    const blockStyle = block ? window.getComputedStyle(block) : null;
    const inset = blockStyle ? (Number.parseFloat(blockStyle.borderTopWidth) || 0) + (Number.parseFloat(blockStyle.paddingTop) || 0) : 0;
    const epic = blockRect && { top: blockRect.top + inset, height: blockRect.height - inset };
    return storyRequirementScrollTop({
        scrollY: window.scrollY,
        stackBottom: revealStackBottom(),
        viewportHeight: window.innerHeight,
        maxScroll: document.documentElement.scrollHeight - window.innerHeight,
        epicTop: epic?.top,
        epicHeight: epic?.height,
        cardTop: card.top,
        cardHeight: card.height,
    });
}

const REVEAL_INTERRUPTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
const REVEAL_SETTLE_FRAMES = 3;
const REVEAL_MAX_FRAMES = 180;
let cancelActiveReveal = null;

// The stack grows on the way down (the filter bar and compact header pin, and the compact header's arrival shifts the page), so the reveal
// re-aims each frame until the page rests on the landing. User input, another scroll, a newer reveal, or the frame cap ends it.
function scrollToRequirement(element, behavior) {
    cancelActiveReveal?.();
    let aimed = requirementScrollTop(element);
    window.scrollTo({ top: aimed, behavior });
    let cancelled = false;
    let frames = 0;
    let still = 0;
    let lastY = window.scrollY;
    const stop = () => {
        cancelled = true;
        REVEAL_INTERRUPTS.forEach(name => window.removeEventListener(name, stop, true));
        if (cancelActiveReveal === stop) cancelActiveReveal = null;
    };
    cancelActiveReveal = stop;
    REVEAL_INTERRUPTS.forEach(name => window.addEventListener(name, stop, true));
    const tick = () => {
        if (cancelled) return;
        frames += 1;
        if (!element.isConnected || frames > REVEAL_MAX_FRAMES) return stop();
        // The reveal's own scroll only closes on its aim; moving away from it means another scroll (the app, a script) took the page.
        if (Math.abs(window.scrollY - aimed) > Math.abs(lastY - aimed) + 1) return stop();
        const top = requirementScrollTop(element);
        if (Math.abs(top - aimed) > 1) {
            aimed = top;
            window.scrollTo({ top, behavior });
            still = 0;
        } else {
            still = Math.abs(window.scrollY - lastY) < 0.5 ? still + 1 : 0;
        }
        lastY = window.scrollY;
        if (still >= REVEAL_SETTLE_FRAMES && Math.abs(window.scrollY - aimed) <= 1) return stop();
        window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
}

function revealStoryRequirement(requirementId, { reducedMotion = false } = {}) {
    const element = findStoryRequirement(requirementId);
    if (!element) return false;

    scrollToRequirement(element, reducedMotion ? 'auto' : 'smooth');

    const previousTimer = requirementHighlightTimers.get(element);
    if (previousTimer) window.clearTimeout(previousTimer);
    element.classList.remove('story-requirement-highlight');
    void element.offsetWidth;
    element.classList.add('story-requirement-highlight');
    element.focus({ preventScroll: true });
    requirementHighlightTimers.set(element, window.setTimeout(() => {
        element.classList.remove('story-requirement-highlight');
        requirementHighlightTimers.delete(element);
    }, 2200));
    return true;
}

export function navigateToStoryRequirement({
    requirementId,
    clearHidingFilters,
    onMissing,
    prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    reveal = revealStoryRequirement,
    schedule = callback => window.requestAnimationFrame(() => window.requestAnimationFrame(callback)),
} = {}) {
    const activate = () => reveal(requirementId, { reducedMotion: prefersReducedMotion() });
    if (activate()) return true;
    clearHidingFilters?.();
    schedule(() => {
        if (!activate()) onMissing?.(requirementId);
    });
    return false;
}
