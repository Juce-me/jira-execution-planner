// §8/D27 — a NEW OR-predicate over epics. It is NOT matchesEngTaskSearch reused as-is: that
// function (engTaskUtils.js) matches stories against an epic-keyed lookup and has no Delivery
// Owner field. This one matches an epic object directly, modeled on the same case-insensitive
// substring semantics.
//
// Client-side over the already-fetched epic set (§8): no extra request, no JQL change. The
// predicate is an OR across every field — an epic with no Delivery Owner still matches on its key
// or summary — and an empty or whitespace-only query is a no-op, never "match nothing".
export function matchesEngBoardSearch(epic, query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return true;
    if (!epic) return false;

    const candidates = [
        epic.key,
        epic.summary,
        epic.assignee?.displayName,
        epic.deliveryOwner?.displayName,
    ];

    return candidates.some((value) => (
        value != null && String(value).toLowerCase().includes(normalizedQuery)
    ));
}
