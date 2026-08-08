const test = require('node:test');
const assert = require('node:assert/strict');

// §8/D27 — a NEW OR-predicate over epics, modeled on matchesEngTaskSearch's case-insensitive
// substring semantics but not that function reused as-is (it matches stories against an
// epic-keyed lookup and has no Delivery Owner field). Client-side over the already-fetched epic
// set; the predicate is an OR across fields, never an AND, and an empty/whitespace query is a
// no-op rather than "match nothing".

async function loadPredicate() {
    const { matchesEngBoardSearch } = await import('../frontend/src/eng/engBoardSearch.js');
    return matchesEngBoardSearch;
}

test('matches key, case-insensitively, by substring', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'DEMO-1001', summary: 'x', assignee: null, deliveryOwner: null };
    assert.equal(matches(epic, 'demo-100'), true);
    assert.equal(matches(epic, 'nope'), false);
});

test('matches summary, case-insensitively, by substring', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'A-1', summary: 'Provision the execution environment', assignee: null, deliveryOwner: null };
    assert.equal(matches(epic, 'EXECUTION'), true);
});

test('matches assignee displayName, case-insensitively, by substring', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'A-1', summary: 'x', assignee: { displayName: 'M. Kaur' }, deliveryOwner: null };
    assert.equal(matches(epic, 'kaur'), true);
});

test('matches Delivery Owner displayName, case-insensitively, by substring (new — §8, D27)', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'A-1', summary: 'x', assignee: { displayName: 'M. Kaur' }, deliveryOwner: { displayName: 'N. Perez' } };
    assert.equal(matches(epic, 'perez'), true);
});

test('OR not AND: a null Delivery Owner still matches on key or summary', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'A-1', summary: 'Refund pipeline', assignee: null, deliveryOwner: null };
    assert.equal(matches(epic, 'refund'), true);
});

test('OR not AND: an epic matching only on Delivery Owner is kept', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'A-1', summary: 'Unrelated summary', assignee: { displayName: 'Other Person' }, deliveryOwner: { displayName: 'N. Perez' } };
    assert.equal(matches(epic, 'perez'), true);
});

test('a query matching nothing on the epic excludes it', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'A-1', summary: 'Unrelated summary', assignee: { displayName: 'Other Person' }, deliveryOwner: { displayName: 'N. Perez' } };
    assert.equal(matches(epic, 'zzz-nomatch'), false);
});

test('empty query is a no-op, matches everything', async () => {
    const matches = await loadPredicate();
    assert.equal(matches({ key: 'A-1' }, ''), true);
    assert.equal(matches(null, ''), true);
});

test('whitespace-only query is a no-op too', async () => {
    const matches = await loadPredicate();
    assert.equal(matches({ key: 'A-1' }, '   '), true);
});

test('a null epic with a real query does not throw and does not match', async () => {
    // This is the raw predicate's own contract: it has nothing to search against a genuinely
    // null epic record. It is NOT license for a caller to pass a bare (possibly-null)
    // `group.epic` straight through — dashboard.jsx instead merges `group.key` in first (see the
    // next test), so a group whose epic lookup is thin is still findable by the key its card
    // shows.
    const matches = await loadPredicate();
    assert.equal(matches(null, 'anything'), false);
});

test('a group with no resolved epic record is still findable by the key its card shows', async () => {
    // dashboard.jsx feeds this predicate `{ key: group.key, ...group.epic }`, never `group.epic`
    // bare (§8) — group.epic can be null (groupTasksByEpic: `epic: epicDetails[epicKey] || null`)
    // while `group.key` is always populated, and EngBoardEpicCard.jsx titles the card from
    // `epicGroup.key` in exactly that case. Searching by that key must not make the card vanish.
    const matches = await loadPredicate();
    const merged = { key: 'PLAT-9001', ...null };
    assert.equal(matches(merged, 'plat-9001'), true);
});

test('a null assignee or deliveryOwner does not throw', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'A-1', summary: 'x', assignee: null, deliveryOwner: null };
    assert.doesNotThrow(() => matches(epic, 'x'));
});

// While no Delivery Owner field is configured the backend omits the key entirely, so every
// epic arrives without it. The predicate must degrade to key/summary/assignee, not to
// "match nothing".
test('an epic with no deliveryOwner key at all still matches on its other fields', async () => {
    const matches = await loadPredicate();
    const epic = { key: 'A-1', summary: 'Refund pipeline', assignee: { displayName: 'M. Kaur' } };
    assert.equal('deliveryOwner' in epic, false);
    assert.equal(matches(epic, 'a-1'), true);
    assert.equal(matches(epic, 'refund'), true);
    assert.equal(matches(epic, 'kaur'), true);
    assert.equal(matches(epic, 'n. perez'), false);
});
