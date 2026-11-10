const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../frontend/src/eng/planningInclusionDraft.js');
const entry = (issueId, included = false, revision = 0) => ({ issueId, included, revision });
const change = (issueId, included, baseRevision = 0) => ({ issueId, included, baseRevision });

test('bulk actions preserve off-scope work and cover the entire supplied child pool', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft({ entries: [entry('9', true, 3)] });
    draft.apply(Array.from({ length: 240 }, (_, i) => String(i + 100)), true);
    draft.apply(['100', '101'], false);
    assert.equal(draft.effectiveEntries.get('9').included, true);
    assert.equal(draft.effectiveEntries.get('339').included, true);
    assert.equal(draft.dirtyChanges.size, 238);
    assert.deepEqual(draft.dirtyChanges.get('339'), change('339', true));
});

test('no-op gestures neither dirty nor initialize nor consume Undo', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft({ planExists: false });
    draft.apply([], true);
    draft.apply(['1', '1'], false);
    assert.equal(draft.actionSequence, 0);
    assert.equal(draft.dirty, false);
    assert.equal(draft.initializationPending, false);
    assert.equal(draft.undo(), false);
    draft.apply(['1', '1'], true);
    draft.apply(['1'], true);
    assert.equal(draft.actionSequence, 1);
    assert.equal(draft.undo(), true);
    assert.equal(draft.canUndo, false);
    assert.equal(draft.dirty, false);
});

test('a genuine include then remove can save an explicit empty initial plan', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft({ planExists: false });
    draft.apply(['1'], true);
    draft.apply(['1'], false);
    assert.deepEqual(draft.snapshot().changes, []);
    assert.equal(draft.snapshot().initializePlan, true);
    assert.equal(draft.dirty, true);
    draft.undo();
    assert.equal(draft.effectiveEntries.get('1').included, true);
    draft.undo();
    assert.equal(draft.initializationPending, false);
    assert.equal(draft.dirty, false);
    draft.apply(['2'], true);
    draft.discard([], { planExists: false });
    assert.equal(draft.dirty, false);
    assert.equal(draft.canUndo, false);
});

test('Undo retains twenty real gestures and restores each multi-issue gesture together', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft();
    for (let i = 1; i <= 22; i++) draft.apply([String(i), String(i + 100)], true);
    for (let i = 0; i < 20; i++) assert.equal(draft.undo(), true);
    assert.equal(draft.undo(), false);
    assert.deepEqual([...draft.dirtyChanges.keys()].sort(), ['1', '101', '102', '2']);
});

test('confirmation rebases later ABA desires and retains only later Undo gestures', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft({ entries: [entry('1', false, 4), entry('2', true, 2)] });
    draft.apply(['1'], true);
    const submitted = draft.snapshot();
    draft.apply(['1', '2'], false);
    draft.confirm(submitted, [entry('1', true, 5)]);
    assert.deepEqual([...draft.dirtyChanges.values()].sort((a, b) => a.issueId.localeCompare(b.issueId)), [change('1', false, 5), change('2', false, 2)]);
    assert.equal(draft.undo(), true);
    assert.equal(draft.effectiveEntries.get('1').included, true);
    assert.equal(draft.effectiveEntries.get('2').included, true);
    assert.equal(draft.dirty, false);
    assert.equal(draft.undo(), false);
});

test('confirmation preserves a later gesture even when its current value equals the submission', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft();
    draft.apply(['1'], true);
    const submitted = draft.snapshot();
    draft.apply(['1'], false);
    draft.apply(['1'], true);
    draft.confirm(submitted, [entry('1', true, 1)]);
    assert.equal(draft.dirty, false);
    draft.undo();
    assert.deepEqual(draft.dirtyChanges.get('1'), change('1', false, 1));
    draft.undo();
    assert.equal(draft.dirty, false);
});

test('snapshot and exposed maps cannot mutate authority; rejected saves leave original Undo intact', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft();
    draft.apply(['1'], true);
    const submitted = draft.snapshot();
    assert.ok(Object.isFrozen(submitted) && Object.isFrozen(submitted.changes) && Object.isFrozen(submitted.changes[0]));
    draft.apply(['2'], true);
    assert.deepEqual(submitted.changes, [change('1', true)]);
    draft.effectiveEntries.clear();
    draft.dirtyChanges.get('1').included = false;
    assert.equal(draft.effectiveEntries.get('1').included, true);
    assert.equal(draft.dirtyChanges.get('1').included, true);
    assert.throws(() => draft.confirm(submitted, []));
    assert.equal(draft.dirty, true);
    assert.equal(draft.undo(), true);
    assert.equal(draft.dirty, true);
    assert.equal(draft.undo(), true);
    assert.equal(draft.dirty, false);
});

test('saved empty plans never gain initialization intent and confirmation initializes absent plans', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft({ planExists: false });
    draft.apply(['1'], true);
    draft.apply(['1'], false);
    draft.confirm(draft.snapshot(), []);
    assert.equal(draft.initializationPending, false);
    assert.equal(draft.dirty, false);
    draft.apply(['1'], true);
    draft.apply(['1'], false);
    assert.equal(draft.dirty, false);
    draft.discard([], { planExists: true });
    assert.equal(draft.canUndo, false);
});

test('a validated recovered snapshot can confirm without sharing object identity', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft();
    draft.apply(['1'], true);
    const submitted = JSON.parse(JSON.stringify(draft.snapshot()));
    draft.confirm(submitted, [entry('1', true, 1)]);
    assert.equal(draft.dirty, false);
    assert.equal(draft.canUndo, false);
    assert.equal(draft.effectiveEntries.get('1').revision, 1);
});

test('an acknowledgement cannot initialize a clean absent plan or roll back a newer revision', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft({ planExists: false });
    assert.throws(() => draft.confirm(draft.snapshot(), []));
    draft.discard([entry('1', true, 6)], { planExists: true });
    assert.throws(() => draft.confirm({ sequence: 0, initializePlan: false, changes: [change('1', true, 4)] }, [entry('1', true, 5)]));
    assert.equal(draft.effectiveEntries.get('1').revision, 6);
});

test('invalid identities, revisions, flags and acknowledgements fail atomically', async () => {
    const { createPlanningInclusionDraft } = await load();
    for (const issueId of ['', '01', '0', 'PLAN-1', 'placeholder', 1, {}, '1'.repeat(129)]) {
        assert.throws(() => createPlanningInclusionDraft({ entries: [entry(issueId)] }));
        const draft = createPlanningInclusionDraft();
        assert.throws(() => draft.apply(['1', issueId], true));
        assert.equal(draft.dirty, false);
    }
    for (const revision of [-1, 0.1, true, 2147483647]) assert.throws(() => createPlanningInclusionDraft({ entries: [entry('1', false, revision)] }));
    assert.throws(() => createPlanningInclusionDraft({ entries: [entry('1'), entry('1')] }));
    const draft = createPlanningInclusionDraft({ entries: [entry('1', false, 3)] });
    assert.throws(() => draft.apply(Array(1), true));
    assert.throws(() => draft.apply(['1'], 1));
    assert.throws(() => draft.discard([], { planExists: null }));
    draft.apply(['1'], true);
    const submitted = draft.snapshot();
    for (const entries of [[entry('1', false, 4)], [entry('1', true, 2)], [entry('1', true, 4), entry('2')]]) assert.throws(() => draft.confirm(submitted, entries));
    assert.deepEqual(draft.dirtyChanges.get('1'), change('1', true, 3));
});

test('stored included entries cannot have revision zero', async () => {
    const { createPlanningInclusionDraft } = await load();
    assert.throws(() => createPlanningInclusionDraft({ entries: [{ issueId: '1', included: true, revision: 0 }] }), TypeError);
    const draft = createPlanningInclusionDraft();
    draft.apply(['1'], true);
    assert.throws(() => draft.confirm(draft.snapshot(), [{ issueId: '1', included: true, revision: 0 }]), TypeError);
    assert.equal(draft.dirty, true);
});

test('recovered deltas retain original revisions without creating Undo history', async () => {
    const { createPlanningInclusionDraft } = await load();
    const draft = createPlanningInclusionDraft({ entries: [entry('1', false, 2)] });
    draft.restore([change('1', true, 2)], { sequence: 4 });
    assert.equal(draft.canUndo, false); assert.equal(draft.actionSequence, 4);
    assert.deepEqual(draft.snapshot().changes, [change('1', true, 2)]);
    assert.throws(() => draft.restore([change('1', true, 1)]), TypeError);
    assert.equal(draft.effectiveEntries.get('1').included, true);
    draft.apply(['1'], false); assert.equal(draft.undo(), true);
    assert.equal(draft.effectiveEntries.get('1').included, true);
});
