export const GLARE_CAP = 8;
const GLARE_ANIMATIONS = new Set(['epic-refresh-glint', 'epic-refresh-tint']);

export function selectGlareKeys({ changedKeys, rects, viewport, suppressed = new Set(), cap = GLARE_CAP }) {
    return changedKeys
        .filter(key => !suppressed.has(key) && rects.has(key))
        .map(key => ({ key, rect: rects.get(key) }))
        .filter(({ rect }) => rect.bottom > viewport.top && rect.top < viewport.bottom)
        .sort((a, b) => a.rect.top - b.rect.top)
        .slice(0, cap)
        .map(({ key }) => key);
}

export function glareDelayMs(rectTop, viewportTop) {
    return Math.max(0, rectTop - viewportTop) * 0.4;
}

// React owns className, so the glare is an attribute React never renders.
export function playGlare(element, delayMs = 0) {
    if (!element) return;
    element.style.setProperty('--glare-delay', `${Math.round(delayMs)}ms`);
    element.removeAttribute('data-glare');
    void element.offsetWidth;
    element.setAttribute('data-glare', 'on');
    const onEnd = event => {
        if (event.target !== element || !GLARE_ANIMATIONS.has(event.animationName)) return;
        element.removeAttribute('data-glare');
        element.removeEventListener('animationend', onEnd);
    };
    element.addEventListener('animationend', onEnd);
}
