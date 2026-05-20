function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function viewportSize() {
    if (typeof window === 'undefined') {
        return { width: 0, height: 0 };
    }
    return {
        width: Number(window.innerWidth) || 0,
        height: Number(window.innerHeight) || 0
    };
}

function normalizeBoundary(boundaryRect, viewportWidth, viewportHeight, edgeGutter) {
    const viewport = {
        left: edgeGutter,
        right: Math.max(edgeGutter, viewportWidth - edgeGutter),
        top: edgeGutter,
        bottom: Math.max(edgeGutter, viewportHeight - edgeGutter)
    };
    if (!boundaryRect) return viewport;
    return {
        left: Math.max(viewport.left, Number(boundaryRect.left || 0) + edgeGutter),
        right: Math.min(viewport.right, Number(boundaryRect.right || viewportWidth) - edgeGutter),
        top: Math.max(viewport.top, Number(boundaryRect.top || 0) + edgeGutter),
        bottom: Math.min(viewport.bottom, Number(boundaryRect.bottom || viewportHeight) - edgeGutter)
    };
}

export function resolveFloatingHoverPosition({
    x,
    y,
    boundaryRect = null,
    bubbleWidth,
    bubbleHeight,
    edgeGutter = 12,
    pointerGap = 12,
    verticalInset = 0
}) {
    const viewport = viewportSize();
    if (!viewport.width || !viewport.height) {
        return { x, y, side: 'right' };
    }

    const bounds = normalizeBoundary(boundaryRect, viewport.width, viewport.height, edgeGutter);
    const effectiveWidth = Math.min(
        Number(bubbleWidth) || 0,
        Math.max(0, viewport.width - (edgeGutter * 2))
    );
    const effectiveHeight = Math.min(
        Number(bubbleHeight) || 0,
        Math.max(0, viewport.height - (edgeGutter * 2))
    );
    const leftSpace = x - bounds.left - pointerGap;
    const rightSpace = bounds.right - x - pointerGap;
    const side = rightSpace >= effectiveWidth || rightSpace >= leftSpace ? 'right' : 'left';
    const minX = side === 'left'
        ? bounds.left + effectiveWidth + pointerGap
        : bounds.left;
    const maxX = side === 'left'
        ? bounds.right
        : Math.max(bounds.left, bounds.right - effectiveWidth - pointerGap);
    const minY = Math.max(bounds.top + (effectiveHeight / 2), verticalInset, edgeGutter + (effectiveHeight / 2));
    const maxY = Math.max(minY, bounds.bottom - (effectiveHeight / 2));

    return {
        x: clamp(x, minX, maxX),
        y: clamp(y, minY, maxY),
        side
    };
}
