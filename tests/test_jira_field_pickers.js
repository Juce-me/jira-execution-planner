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

test('accepted field reads preserve a newer draft and advance its dirty baseline', async () => {
    const { applyAcceptedFieldConfig } = await loadModule();
    const draft = { fieldId: 'customfield_edited', fieldName: 'Edited locally' };
    const initialBaselines = [
        '',
        JSON.stringify({ fieldId: 'customfield_old', fieldName: 'Previously saved' }),
    ];

    for (const initialBaseline of initialBaselines) {
        const baselineRef = { current: initialBaseline };
        const setterCalls = [];
        let baselineAccepted = 0;
        let currentDraft = JSON.stringify({ fieldId: '', fieldName: '' });
        const requestDraft = currentDraft;
        let releaseRead;
        const heldRead = new Promise(resolve => { releaseRead = resolve; });
        const completion = heldRead.then(() => applyAcceptedFieldConfig({
            value: { fieldId: 'customfield_server', fieldName: 'Saved on server' },
            requestDraft,
            currentDraft,
            setId: value => setterCalls.push(['id', value]),
            setName: value => setterCalls.push(['name', value]),
            baselineRef,
            onBaselineAccepted: () => { baselineAccepted += 1; },
        }));
        currentDraft = JSON.stringify(draft);
        releaseRead();
        const result = await completion;

        assert.equal(result.draftApplied, false);
        assert.deepEqual(setterCalls, []);
        assert.equal(baselineRef.current, JSON.stringify({
            fieldId: 'customfield_server',
            fieldName: 'Saved on server',
        }));
        assert.equal(Boolean(baselineRef.current) && JSON.stringify(draft) !== baselineRef.current, true);
        assert.equal(baselineAccepted, 1, 'baseline advancement must invalidate memoized dirty state');
    }
});

test('accepted field reads update an unchanged draft and its baseline together', async () => {
    const { applyAcceptedFieldConfig } = await loadModule();
    const baselineRef = { current: '' };
    const setterCalls = [];
    const requestDraft = JSON.stringify({ fieldId: '', fieldName: '' });

    const result = applyAcceptedFieldConfig({
        value: { fieldId: 'customfield_server', fieldName: 'Saved on server' },
        requestDraft,
        currentDraft: requestDraft,
        setId: value => setterCalls.push(['id', value]),
        setName: value => setterCalls.push(['name', value]),
        baselineRef,
    });

    assert.equal(result.draftApplied, true);
    assert.deepEqual(setterCalls, [
        ['id', 'customfield_server'],
        ['name', 'Saved on server'],
    ]);
    assert.equal(baselineRef.current, JSON.stringify({
        fieldId: 'customfield_server',
        fieldName: 'Saved on server',
    }));
});

test('fallback field reads keep edits made while the parent config request is pending', async () => {
    const { applyAcceptedFieldConfig } = await loadModule();
    const { createSettingsDraftReadGuard } = await import('../frontend/src/settings/settingsConfigReadState.js');
    const initialDraft = JSON.stringify({ fieldId: '', fieldName: '' });
    const editedDraft = JSON.stringify({
        fieldId: 'customfield_edited',
        fieldName: 'Edited while config loaded',
    });
    const currentDrafts = { sprintField: initialDraft };
    const draftReadGuard = createSettingsDraftReadGuard(() => currentDrafts);
    const baselineRef = { current: '' };
    const setterCalls = [];
    let releaseParentConfig;
    let releaseFallbackRead;
    let markFallbackStarted;
    const parentConfig = new Promise(resolve => { releaseParentConfig = resolve; });
    const fallbackRead = new Promise(resolve => { releaseFallbackRead = resolve; });
    const fallbackStarted = new Promise(resolve => { markFallbackStarted = resolve; });

    const completion = (async () => {
        const config = await parentConfig;
        assert.equal(config.sharedConfig, undefined, 'parent response must require section fallbacks');
        const readOptions = draftReadGuard.fieldReadOptions('sprintField');
        const requestDraft = readOptions.requestDraft ?? currentDrafts.sprintField;
        const preserveDraft = readOptions.preserveDraft ?? false;
        markFallbackStarted();
        const value = await fallbackRead;
        return applyAcceptedFieldConfig({
            value,
            requestDraft,
            currentDraft: currentDrafts.sprintField,
            preserveDraft,
            setId: value => setterCalls.push(['id', value]),
            setName: value => setterCalls.push(['name', value]),
            baselineRef,
        });
    })();

    currentDrafts.sprintField = editedDraft;
    releaseParentConfig({ authMode: 'atlassian_oauth' });
    await fallbackStarted;
    releaseFallbackRead({ fieldId: 'customfield_server', fieldName: 'Saved on server' });
    const result = await completion;

    assert.equal(result.draftApplied, false, 'fallback must not replace the interim user edit');
    assert.deepEqual(setterCalls, []);
    assert.equal(currentDrafts.sprintField, editedDraft);
    assert.equal(baselineRef.current, JSON.stringify({
        fieldId: 'customfield_server',
        fieldName: 'Saved on server',
    }));
    assert.notEqual(currentDrafts.sprintField, baselineRef.current, 'the edit remains Save-eligible');
});

test('shared bootstrap advances every field baseline while preserving only edited drafts', async () => {
    const { applyAcceptedFieldConfigs } = await loadModule();
    const sprintBaselineRef = { current: '' };
    const teamBaselineRef = { current: '' };
    const sprintDraft = JSON.stringify({ fieldId: 'customfield_edited', fieldName: 'Edited sprint' });
    const teamDraft = JSON.stringify({ fieldId: '', fieldName: '' });
    const setterCalls = [];

    applyAcceptedFieldConfigs([
        {
            section: 'sprintField',
            value: { fieldId: 'customfield_sprint', fieldName: 'Saved sprint' },
            setId: value => setterCalls.push(['sprint-id', value]),
            setName: value => setterCalls.push(['sprint-name', value]),
            baselineRef: sprintBaselineRef,
            readCurrentDraft: () => sprintDraft,
        },
        {
            section: 'teamField',
            value: { fieldId: 'customfield_team', fieldName: 'Saved team' },
            setId: value => setterCalls.push(['team-id', value]),
            setName: value => setterCalls.push(['team-name', value]),
            baselineRef: teamBaselineRef,
            readCurrentDraft: () => teamDraft,
        },
    ], {
        shouldPreserveDraft: section => section === 'sprintField',
    });

    assert.equal(sprintBaselineRef.current, JSON.stringify({
        fieldId: 'customfield_sprint',
        fieldName: 'Saved sprint',
    }));
    assert.equal(teamBaselineRef.current, JSON.stringify({
        fieldId: 'customfield_team',
        fieldName: 'Saved team',
    }));
    assert.equal(sprintDraft !== sprintBaselineRef.current, true, 'edited sprint remains save-eligible');
    assert.deepEqual(setterCalls, [
        ['team-id', 'customfield_team'],
        ['team-name', 'Saved team'],
    ]);
});
