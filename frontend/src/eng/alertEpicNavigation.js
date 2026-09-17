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

function stickyBottom() {
    const selectors = [
        '.compact-sticky-header.is-visible',
        '.planning-panel.open',
        '.eng-filter-bar',
        '.epic-header',
    ];
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

function revealStoryRequirement(requirementId, { reducedMotion = false } = {}) {
    const element = findStoryRequirement(requirementId);
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const topGuard = stickyBottom() + 12;
    const availableHeight = Math.max(0, window.innerHeight - topGuard);
    const targetTop = Math.max(0, window.scrollY + rect.top - topGuard - Math.max(0, (availableHeight - rect.height) / 2));
    window.scrollTo({ top: targetTop, behavior: reducedMotion ? 'auto' : 'smooth' });

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
