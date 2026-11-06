// EntityNames: the user-visible names of the work roles, resolved from the configured Jira types (summary
// `roleTypes`), refreshed by the names a full Catch Up read observed for the same configuration digest.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import('../frontend/src/eng/engWorkModel.js');
const type = (id, name, hierarchyLevel) => ({ id, name, hierarchyLevel });
const DELIVERY_TYPES = Object.freeze({
    planning: type('6', 'Epic', 1), parent: type('11700', 'Initiative', 2), ancestor: type('12723', 'Objective', 3), optionalAncestor: type('13756', 'Strategy', 4),
});

test('Legacy and unpromoted resolve to the Legacy defaults', async () => {
    const { resolveEntityNames } = await load();
    for (const names of [resolveEntityNames('legacy'), resolveEntityNames(undefined), resolveEntityNames('anything', null)]) {
        assert.deepEqual({ child: names.child, childPlural: names.childPlural, parent: names.parent, parentPlural: names.parentPlural, ancestor: names.ancestor,
            childKind: names.childKind, parentKind: names.parentKind, ancestorKind: names.ancestorKind },
        { child: 'Story', childPlural: 'Stories', parent: 'Epic', parentPlural: 'Epics', ancestor: 'Initiative', childKind: 'story', parentKind: 'epic', ancestorKind: 'initiative' });
        assert.equal(names.model, 'legacy');
        assert.deepEqual([names.childLevel, names.parentLevel, names.ancestorLevel], [0, 1, 2]);
    }
});

test('Legacy compatibility slots (id null) keep their names; never keyed on id', async () => {
    const { resolveEntityNames } = await load();
    const names = resolveEntityNames('legacy', { planning: type(null, 'Story', 0), parent: type(null, 'Epic', 1), ancestor: type(null, 'Initiative', 2), optionalAncestor: null });
    assert.equal(names.child, 'Story');
    assert.equal(names.parent, 'Epic');
    assert.equal(names.ancestorKind, 'initiative');
});

test('DELIVERY roleTypes name Epic/Initiative/Objective with kinds from levels', async () => {
    const { resolveEntityNames } = await load();
    const names = resolveEntityNames('rnd_2027', DELIVERY_TYPES, null, 'd1');
    assert.equal(names.model, 'rnd_2027');
    assert.deepEqual([names.child, names.parent, names.ancestor, names.optionalAncestor], ['Epic', 'Initiative', 'Objective', 'Strategy']);
    assert.deepEqual([names.childPlural, names.parentPlural, names.ancestorPlural], ['Epics', 'Initiatives', 'Objectives']);
    assert.deepEqual([names.childKind, names.parentKind, names.ancestorKind], ['epic', 'initiative', 'objective']);
    assert.deepEqual([names.childLevel, names.parentLevel, names.ancestorLevel], [1, 2, 3]);
});

test('DELIVERY carries its configured Jira type ids for the type icons; Legacy and unusable ids carry none', async () => {
    const { resolveEntityNames } = await load();
    const delivery = resolveEntityNames('rnd_2027', DELIVERY_TYPES, null, 'd1');
    assert.deepEqual([delivery.childTypeId, delivery.parentTypeId, delivery.ancestorTypeId], ['6', '11700', '12723']);
    const bare = resolveEntityNames('rnd_2027');
    assert.deepEqual([bare.childTypeId, bare.parentTypeId, bare.ancestorTypeId], [null, null, null]);
    const odd = resolveEntityNames('rnd_2027', { planning: type(null, 'Epic', 1), parent: type('../x', 'Initiative', 2), ancestor: type(12723, 'Objective', 3) });
    assert.deepEqual([odd.childTypeId, odd.parentTypeId, odd.ancestorTypeId], [null, null, null]);
    const legacy = resolveEntityNames('legacy', { planning: type('10002', 'Story', 0), parent: type('10000', 'Epic', 1), ancestor: type('10001', 'Initiative', 2) });
    assert.deepEqual([legacy.childTypeId, legacy.parentTypeId, legacy.ancestorTypeId], [null, null, null]);
});

test('new model without a capture falls back to the model defaults, Strategy included', async () => {
    const { resolveEntityNames } = await load();
    const names = resolveEntityNames('rnd_2027');
    assert.deepEqual([names.child, names.parent, names.ancestor, names.optionalAncestor], ['Epic', 'Initiative', 'Objective', 'Strategy']);
    assert.deepEqual([names.childKind, names.parentKind, names.ancestorKind], ['epic', 'initiative', 'objective']);
});

test('a renamed level-1 planning type names the child; the kind stays epic', async () => {
    const { resolveEntityNames } = await load();
    const names = resolveEntityNames('rnd_2027', { ...DELIVERY_TYPES, planning: type('6', 'Deliverable', 1) }, null, 'd1');
    assert.equal(names.child, 'Deliverable');
    assert.equal(names.childPlural, 'Deliverables');
    assert.equal(names.childKind, 'epic');
});

test('an observed name wins only for the same configuration digest', async () => {
    const { resolveEntityNames } = await load();
    const observed = { digest: 'd1', planning: 'Work Package', parent: null };
    assert.equal(resolveEntityNames('rnd_2027', DELIVERY_TYPES, observed, 'd1').child, 'Work Package');
    assert.equal(resolveEntityNames('rnd_2027', DELIVERY_TYPES, observed, 'd1').parent, 'Initiative', 'null observed parent keeps the capture');
    assert.equal(resolveEntityNames('rnd_2027', DELIVERY_TYPES, observed, 'd0').child, 'Epic', 'other digest keeps the capture');
    assert.equal(resolveEntityNames('rnd_2027', DELIVERY_TYPES, { digest: 'd1', planning: 'Epic', parent: 'Theme' }, 'd1').parent, 'Theme');
});

test('non-increasing levels fall back to every model-default level; names stay', async () => {
    const { resolveEntityNames } = await load();
    const names = resolveEntityNames('rnd_2027', { planning: type('6', 'Epic', 3), parent: type('7', 'Initiative', 2), ancestor: type('8', 'Objective', 1), optionalAncestor: null });
    assert.deepEqual([names.childLevel, names.parentLevel, names.ancestorLevel], [1, 2, 3]);
    assert.deepEqual([names.childKind, names.parentKind, names.ancestorKind], ['epic', 'initiative', 'objective']);
    assert.equal(names.child, 'Epic');
    const nulls = resolveEntityNames('legacy', { planning: type(null, 'Story', null), parent: null, ancestor: null, optionalAncestor: null });
    assert.deepEqual([nulls.childKind, nulls.parentKind, nulls.ancestorKind], ['story', 'epic', 'initiative']);
    const blank = resolveEntityNames('rnd_2027', { planning: type('6', '  ', 1), parent: null, ancestor: null, optionalAncestor: null });
    assert.equal(blank.child, 'Epic', 'a blank capture never names a role');
});

test('a captured level without its neighbours keeps the sequence increasing', async () => {
    const { resolveEntityNames } = await load();
    const parentOnly = resolveEntityNames('rnd_2027', { planning: null, parent: type('7', 'Objective', 3), ancestor: null, optionalAncestor: null });
    assert.equal(parentOnly.parentKind, 'objective');
    assert.deepEqual([parentOnly.childLevel, parentOnly.parentLevel, parentOnly.ancestorLevel], [1, 3, 4]);
    const reversed = resolveEntityNames('rnd_2027', { planning: type('6', 'Epic', 3), parent: type('7', 'Initiative', 2), ancestor: type('8', 'Objective', 1) });
    assert.deepEqual([reversed.childLevel, reversed.parentLevel, reversed.ancestorLevel], [1, 2, 3], 'captured [3,2,1] takes the defaults');
    const gap = resolveEntityNames('rnd_2027', { planning: type('6', 'Epic', 1), parent: null, ancestor: type('8', 'Objective', 2) });
    assert.deepEqual([gap.childLevel, gap.parentLevel, gap.ancestorLevel], [1, 2, 3], 'no room for the missing parent takes the defaults');
    const childHigh = resolveEntityNames('legacy', { planning: type('6', 'Feature', 2), parent: null, ancestor: null });
    assert.deepEqual([childHigh.childLevel, childHigh.parentLevel, childHigh.ancestorLevel], [2, 3, 4]);
});

test('entityArticle is acronym-aware and shared by every surface', async () => {
    const { entityArticle } = await load();
    const cases = { Initiative: 'an', OKR: 'an', Theme: 'a', 'UX goal': 'a', Epic: 'an', SLA: 'an', Story: 'a', '': 'a' };
    for (const [word, article] of Object.entries(cases)) assert.equal(entityArticle(word), article, word);
    const fs = require('node:fs');
    for (const file of ['frontend/src/stats/StatsPanel.jsx', 'frontend/src/eng/EngView.jsx', 'frontend/src/onboarding/onboardingSteps.js']) {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(source, /entityArticle/, file);
        assert.doesNotMatch(source, /\/\^\[aeiou\]\/|Cross = an /, `${file} has no local article rule`);
    }
});

test('plural rule handles irregular and all-caps names', async () => {
    const { pluralizeEntityName } = await load();
    const cases = { Capability: 'Capabilities', Process: 'Processes', OKR: 'OKRs', 'Q&A': 'Q&As', Story: 'Stories', Epic: 'Epics', Box: 'Boxes',
        Batch: 'Batches', Wish: 'Wishes', Day: 'Days', 'Work Package': 'Work Packages', 'Item 2': 'Item 2s', Quiz: 'Quizes' };
    for (const [name, plural] of Object.entries(cases)) assert.equal(pluralizeEntityName(name), plural, name);
});

test('lowerEntityWord keeps acronyms and lowercases ordinary names', async () => {
    const { lowerEntityWord } = await load();
    assert.equal(lowerEntityWord('OKR'), 'OKR');
    assert.equal(lowerEntityWord('OKRs'), 'OKRs');
    assert.equal(lowerEntityWord('Capabilities'), 'capabilities');
    assert.equal(lowerEntityWord('Work Package'), 'work package');
});

test('formatEntityCount: 1 is singular, every other number plural, Legacy included', async () => {
    const { formatEntityCount, resolveEntityNames } = await load();
    const names = resolveEntityNames('rnd_2027', DELIVERY_TYPES);
    assert.equal(formatEntityCount(1, names, 'child'), '1 Epic');
    assert.equal(formatEntityCount(0, names, 'child'), '0 Epics');
    assert.equal(formatEntityCount(2, names, 'parent'), '2 Initiatives');
    assert.equal(formatEntityCount(1, names, 'ancestor'), '1 Objective');
    const capability = resolveEntityNames('rnd_2027', { ...DELIVERY_TYPES, planning: type('6', 'Capability', 1) });
    assert.equal(formatEntityCount(1, capability, 'child'), '1 Capability');
    assert.equal(formatEntityCount(2, capability, 'child'), '2 Capabilities');
    assert.equal(formatEntityCount(1, resolveEntityNames('legacy'), 'child'), '1 Story');
});

test('workEntityNames(model) stays the default-only wrapper', async () => {
    const { workEntityNames } = await load();
    assert.deepEqual(workEntityNames('rnd_2027'), { child: 'Epic', childPlural: 'Epics', parent: 'Initiative', parentPlural: 'Initiatives' });
});

test('reviewLabels takes EntityNames; parentColumnId follows the model', async () => {
    const { resolveEntityNames } = await load();
    const { reviewLabels } = await import('../frontend/src/eng/planningReviewKinds.js');
    assert.deepEqual(reviewLabels(), { parent: 'Epic', parentPlural: 'Epics', child: 'Story', childPlural: 'Stories', parentColumnId: 'epic' });
    const renamed = reviewLabels(resolveEntityNames('rnd_2027', { ...DELIVERY_TYPES, planning: type('6', 'Deliverable', 1) }));
    assert.deepEqual(renamed, { parent: 'Initiative', parentPlural: 'Initiatives', child: 'Deliverable', childPlural: 'Deliverables', parentColumnId: 'initiative' });
    assert.equal(reviewLabels('rnd_2027').parentColumnId, 'initiative', 'a model string still resolves until callers migrate');
});

test('useWorkEntityNames resolves the active summary and observed names, memoized on values', () => {
    const { mountBundledHook } = require('./react_hook_harness');
    let props = { workModel: 'rnd_2027', activeSummary: { id: 'delivery', digest: 'd1', roleTypes: DELIVERY_TYPES }, observed: null };
    const mounted = mountBundledHook({ entry: path.resolve('frontend/src/eng/useWorkEntityNames.js'), exportName: 'useWorkEntityNames', makeProps: () => props });
    const first = mounted.render();
    assert.equal(first.child, 'Epic');
    props = { ...props, observed: { digest: 'd1', planning: 'Work Package', parent: null } };
    const second = mounted.render();
    assert.equal(second.child, 'Work Package');
    props = { ...props, observed: { digest: 'd1', planning: 'Work Package', parent: null } };
    assert.equal(mounted.render(), second, 'equal observed values keep the same object');
    props = { workModel: 'legacy', activeSummary: null, observed: null };
    assert.equal(mounted.render().child, 'Story');
});
