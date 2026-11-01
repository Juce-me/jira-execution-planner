// Track-level pointer resolution for StackedBar's strip variant (#323): which segment lies at `fraction` (0..1 of the
// track width) when the segments are laid out left to right in `order`, each `value / total` wide. Returns the
// segment key, or null past the last segment (the track is wider than the segments when `total` is an axis).
export function segmentAtFraction(segments, order, total, fraction) {
    if (!(total > 0) || !(fraction >= 0) || fraction > 1) return null;
    const byKey = new Map((segments || []).map(segment => [segment.key, segment]));
    let end = 0;
    for (const key of order || []) {
        const value = byKey.get(key)?.value || 0;
        if (value <= 0) continue;
        end += value / total;
        if (fraction < end) return key;
    }
    return null;
}
