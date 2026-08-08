const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/settings/useJiraFieldPickers.js');
}

function field(id, name) {
    return { id, name };
}

function manyFields(count) {
    const fields = [];
    for (let i = 0; i < count; i += 1) {
        fields.push(field(`field-${i}`, `Field ${i}`));
    }
    return fields;
}

test('makeFieldSearchResults returns the first 20 fields for an empty query', async () => {
    const { makeFieldSearchResults } = await loadModule();
    const fields = manyFields(25);
    assert.deepEqual(makeFieldSearchResults('', fields).items, fields.slice(0, 20));
});

test('makeFieldSearchResults returns the first 20 fields for a whitespace-only query', async () => {
    const { makeFieldSearchResults } = await loadModule();
    const fields = manyFields(25);
    assert.deepEqual(makeFieldSearchResults('   ', fields).items, fields.slice(0, 20));
});

test('makeFieldSearchResults matches on id, case-insensitively', async () => {
    const { makeFieldSearchResults } = await loadModule();
    const fields = [field('customfield_10010', 'Sprint'), field('customfield_10020', 'Team')];
    assert.deepEqual(makeFieldSearchResults('CUSTOMFIELD_10010', fields).items, [fields[0]]);
});

test('makeFieldSearchResults matches on name, case-insensitively', async () => {
    const { makeFieldSearchResults } = await loadModule();
    const fields = [field('customfield_10010', 'Sprint'), field('customfield_10020', 'Team')];
    assert.deepEqual(makeFieldSearchResults('sprint', fields).items, [fields[0]]);
    assert.deepEqual(makeFieldSearchResults('TEAM', fields).items, [fields[1]]);
});

test('makeFieldSearchResults caps matches at 20 results', async () => {
    const { makeFieldSearchResults } = await loadModule();
    const fields = manyFields(30).map((f) => field(f.id, 'Shared Name'));
    const results = makeFieldSearchResults('shared', fields);
    assert.equal(results.items.length, 20);
    assert.deepEqual(results.items, fields.slice(0, 20));
});

// A field the admin cannot see is a field they cannot configure, and the catalog on a real
// instance runs to hundreds of fields. Truncation is fine; hiding the fact is the defect.
test('makeFieldSearchResults reports how many matches it truncated away', async () => {
    const { makeFieldSearchResults } = await loadModule();
    const fields = manyFields(30).map((f) => field(f.id, 'Shared Name'));
    const results = makeFieldSearchResults('shared', fields);
    assert.equal(results.total, 30);
    assert.equal(results.truncated, true);
});

test('makeFieldSearchResults reports no truncation when every match is shown', async () => {
    const { makeFieldSearchResults } = await loadModule();
    const fields = manyFields(5);
    const results = makeFieldSearchResults('field', fields);
    assert.equal(results.items.length, 5);
    assert.equal(results.total, 5);
    assert.equal(results.truncated, false);
});

function makeKeyDownHarness(results, indexState) {
    const calls = { preventDefault: 0, stopPropagation: 0 };
    let index = indexState;
    let id = '';
    let name = '';
    let query = 'q';
    let open = true;
    const setIndex = (updater) => { index = typeof updater === 'function' ? updater(index) : updater; };
    const setId = (value) => { id = value; };
    const setName = (value) => { name = value; };
    const setQuery = (value) => { query = value; };
    const setOpen = (value) => { open = value; };
    const event = (key) => ({
        key,
        preventDefault: () => { calls.preventDefault += 1; },
        stopPropagation: () => { calls.stopPropagation += 1; },
    });
    return { calls, event, getState: () => ({ index, id, name, query, open }), setIndex, setId, setName, setQuery, setOpen };
}

test('makeFieldKeyDown ArrowDown clamps at results.length - 1', async () => {
    const { makeFieldKeyDown } = await loadModule();
    const results = [field('a', 'A'), field('b', 'B'), field('c', 'C')];
    const harness = makeKeyDownHarness(results, 2);
    const handleKeyDown = makeFieldKeyDown(results, 2, harness.setIndex, harness.setId, harness.setName, harness.setQuery, harness.setOpen);
    handleKeyDown(harness.event('ArrowDown'));
    assert.equal(harness.getState().index, 2, 'already at the last index, should stay clamped');
    assert.equal(harness.calls.preventDefault, 1);
});

test('makeFieldKeyDown ArrowUp clamps at 0', async () => {
    const { makeFieldKeyDown } = await loadModule();
    const results = [field('a', 'A'), field('b', 'B'), field('c', 'C')];
    const harness = makeKeyDownHarness(results, 0);
    const handleKeyDown = makeFieldKeyDown(results, 0, harness.setIndex, harness.setId, harness.setName, harness.setQuery, harness.setOpen);
    handleKeyDown(harness.event('ArrowUp'));
    assert.equal(harness.getState().index, 0, 'already at 0, should stay clamped');
    assert.equal(harness.calls.preventDefault, 1);
});

test('makeFieldKeyDown ArrowDown/ArrowUp step by one away from the bounds', async () => {
    const { makeFieldKeyDown } = await loadModule();
    const results = [field('a', 'A'), field('b', 'B'), field('c', 'C')];
    const down = makeKeyDownHarness(results, 0);
    makeFieldKeyDown(results, 0, down.setIndex, down.setId, down.setName, down.setQuery, down.setOpen)(down.event('ArrowDown'));
    assert.equal(down.getState().index, 1, 'ArrowDown from 0 should advance to 1');
    const up = makeKeyDownHarness(results, 2);
    makeFieldKeyDown(results, 2, up.setIndex, up.setId, up.setName, up.setQuery, up.setOpen)(up.event('ArrowUp'));
    assert.equal(up.getState().index, 1, 'ArrowUp from the last index should step back to 1');
});

test('makeFieldKeyDown ArrowDown/ArrowUp are no-ops with an empty result set', async () => {
    const { makeFieldKeyDown } = await loadModule();
    const harness = makeKeyDownHarness([], 0);
    const handleKeyDown = makeFieldKeyDown([], 0, harness.setIndex, harness.setId, harness.setName, harness.setQuery, harness.setOpen);
    handleKeyDown(harness.event('ArrowDown'));
    handleKeyDown(harness.event('ArrowUp'));
    assert.equal(harness.calls.preventDefault, 0, 'must not call preventDefault when there are no results');
});

test('makeFieldKeyDown Enter selects results[indexState]', async () => {
    const { makeFieldKeyDown } = await loadModule();
    const results = [field('a', 'A'), field('b', 'B'), field('c', 'C')];
    const harness = makeKeyDownHarness(results, 1);
    const handleKeyDown = makeFieldKeyDown(results, 1, harness.setIndex, harness.setId, harness.setName, harness.setQuery, harness.setOpen);
    handleKeyDown(harness.event('Enter'));
    const state = harness.getState();
    assert.equal(state.id, 'b');
    assert.equal(state.name, 'B');
    assert.equal(state.query, '', 'Enter must clear the search query');
    assert.equal(state.open, false, 'Enter must close the search panel');
    assert.equal(harness.calls.preventDefault, 1);
});

test('makeFieldKeyDown Enter falls back to results[0] when the index is out of range', async () => {
    const { makeFieldKeyDown } = await loadModule();
    const results = [field('a', 'A'), field('b', 'B')];
    const harness = makeKeyDownHarness(results, 9);
    const handleKeyDown = makeFieldKeyDown(results, 9, harness.setIndex, harness.setId, harness.setName, harness.setQuery, harness.setOpen);
    handleKeyDown(harness.event('Enter'));
    const state = harness.getState();
    assert.equal(state.id, 'a');
    assert.equal(state.name, 'A');
});

test('makeFieldKeyDown Enter is a no-op with an empty result set', async () => {
    const { makeFieldKeyDown } = await loadModule();
    const harness = makeKeyDownHarness([], 0);
    const handleKeyDown = makeFieldKeyDown([], 0, harness.setIndex, harness.setId, harness.setName, harness.setQuery, harness.setOpen);
    handleKeyDown(harness.event('Enter'));
    assert.equal(harness.calls.preventDefault, 0, 'must not call preventDefault when there are no results');
    assert.equal(harness.getState().id, '', 'no field should be selected');
});

test('makeFieldKeyDown Escape calls preventDefault and stopPropagation and closes the panel', async () => {
    const { makeFieldKeyDown } = await loadModule();
    const results = [field('a', 'A')];
    const harness = makeKeyDownHarness(results, 0);
    const handleKeyDown = makeFieldKeyDown(results, 0, harness.setIndex, harness.setId, harness.setName, harness.setQuery, harness.setOpen);
    handleKeyDown(harness.event('Escape'));
    assert.equal(harness.calls.preventDefault, 1);
    assert.equal(harness.calls.stopPropagation, 1);
    assert.equal(harness.getState().open, false);
});
