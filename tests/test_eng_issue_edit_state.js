const test = require('node:test');
const assert = require('node:assert/strict');

async function loadState() {
    return import('../frontend/src/eng/engIssueEditState.js');
}

function story(key, storyPoints, assignee = null) {
    return { key, fields: { customfield_10004: storyPoints, assignee } };
}

test('confirmed people retain account identity when display names match', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const read = edits.beginRead();
    const mutation = edits.beginMutation('DEMO-1', 'assignee', 'mapping-a');
    edits.confirmMutation(mutation, { accountId: 'account-b', displayName: 'Same Name' });

    const reconciled = edits.reconcileIssues([
        story('DEMO-1', 2, { accountId: 'account-a', displayName: 'Same Name' }),
    ], read);

    assert.deepEqual(reconciled[0].fields.assignee, {
        accountId: 'account-b',
        displayName: 'Same Name',
    });
    edits.finishRead(read);
});

test('newer read observation wins over an older read that resolves last', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const oldRead = edits.beginRead();
    const mutation = edits.beginMutation('DEMO-1', 'storyPoints', 'mapping-a');
    edits.confirmMutation(mutation, 2);
    const newerRead = edits.beginRead();

    assert.equal(edits.reconcileIssues([story('DEMO-1', 3)], newerRead)[0].fields.customfield_10004, 3);
    edits.finishRead(newerRead);
    assert.equal(edits.reconcileIssues([story('DEMO-1', 1.5)], oldRead)[0].fields.customfield_10004, 3);
    edits.finishRead(oldRead);

    const authoritativeRead = edits.beginRead();
    assert.equal(edits.reconcileIssues([story('DEMO-1', 4)], authoritativeRead)[0].fields.customfield_10004, 4);
    edits.finishRead(authoritativeRead);
});

test('read tokens remain active until the caller finishes its final commit', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const read = edits.beginRead();
    const mutation = edits.beginMutation('DEMO-1', 'storyPoints', 'mapping-a');
    edits.confirmMutation(mutation, 2);

    assert.equal(edits.reconcileIssues([story('DEMO-1', 1.5)], read)[0].fields.customfield_10004, 2);
    assert.equal(edits.activeReadCount(), 1);
    edits.finishRead(read);
    assert.equal(edits.activeReadCount(), 0);
});

test('unknown reconciliation requires the same non-null mapping revision', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const mutation = edits.beginMutation('DEMO-1', 'storyPoints', 'mapping-a');
    edits.markUnknown(mutation);

    assert.equal(edits.confirmMutation(mutation, 2, { mappingRevision: null }), false);
    assert.equal(edits.confirmMutation(mutation, 2, { mappingRevision: 'mapping-b' }), false);
    assert.equal(edits.confirmMutation(mutation, 2, { mappingRevision: 'mapping-a' }), true);
});

test('aggregate reads are stale after dispatch and unknown resolution generations', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const statsRead = edits.beginRead({ aggregate: true });
    const mutation = edits.beginMutation('DEMO-1', 'assignee', 'mapping-a');
    assert.equal(edits.isCurrentAggregateRead(statsRead), false);
    const afterDispatch = edits.beginRead({ aggregate: true });
    edits.markUnknown(mutation);
    assert.equal(edits.isCurrentAggregateRead(afterDispatch), false);
});

test('unknown outcomes invalidate affected lazy sources without publishing the desired value', async () => {
    const { createEngIssueEditState } = await loadState();
    const invalidations = [];
    const edits = createEngIssueEditState({ onInvalidate: entry => invalidations.push(entry) });
    const mutation = edits.beginMutation('DEMO-1', 'storyPoints', 'mapping-a');

    edits.markUnknown(mutation);

    assert.deepEqual(invalidations, [{ issueKey: 'DEMO-1', field: 'storyPoints', outcome: 'unknown' }]);
    const read = edits.beginRead();
    assert.equal(edits.reconcileIssues([story('DEMO-1', 1.5)], read)[0].fields.customfield_10004, 1.5);
    edits.finishRead(read);
});

test('loaded state patch covers active arrays and group snapshots without cascading epic owners', async () => {
    const { patchEngLoadedState } = await loadState();
    const person = { accountId: 'owner-2', displayName: 'Owner' };
    const state = {
        productTasks: [story('DEMO-1', 1.5)],
        techTasks: [story('OTHER-1', 3)],
        loadedProductTasks: [story('DEMO-1', 1.5)],
        loadedTechTasks: [],
        readyToCloseProductTasks: [story('DEMO-1', 1.5)],
        readyToCloseTechTasks: [],
        productEpicsInScope: [{ key: 'DEMO-1', deliveryOwner: null, stories: [story('CHILD-1', 2)] }],
        techEpicsInScope: [],
        readyToCloseProductEpicsInScope: [{ key: 'DEMO-1', deliveryOwner: null }],
        readyToCloseTechEpicsInScope: [],
        epicDetails: { 'DEMO-1': { key: 'DEMO-1', deliveryOwner: null } },
        missingPlanningInfoTasks: [story('DEMO-1', null)],
        missingInfoEpics: [{ key: 'DEMO-1', deliveryOwner: null }],
        backlogProductEpics: [{ key: 'DEMO-1', deliveryOwner: null }],
        backlogTechEpics: [],
        selectedTasks: { 'DEMO-1': true },
        selectedTeams: ['team-a'],
        engStatusFilter: ['To Do'],
        planningSelectionMode: 'manual',
    };
    const groups = new Map([
        ['group-a', { ...state }],
        ['group-b', { ...state, searchQuery: 'keep me' }],
    ]);

    const updated = patchEngLoadedState(state, groups, 'DEMO-1', 'deliveryOwner', person);

    assert.deepEqual(updated.state.productEpicsInScope[0].deliveryOwner, person);
    assert.equal(updated.state.productEpicsInScope[0].stories[0].fields.assignee, null);
    assert.deepEqual(updated.state.epicDetails['DEMO-1'].deliveryOwner, person);
    assert.deepEqual(updated.groups.get('group-b').backlogProductEpics[0].deliveryOwner, person);
    assert.equal(updated.groups.get('group-b').searchQuery, 'keep me');
    assert.deepEqual(updated.state.selectedTasks, { 'DEMO-1': true });
    assert.deepEqual(updated.state.selectedTeams, ['team-a']);
});

test('story point zero differs from null and invalidates only dependent lazy sources', async () => {
    const { patchEngLoadedState } = await loadState();
    const state = {
        productTasks: [story('DEMO-1', null)],
        missingPlanningInfoTasks: [{ ...story('DEMO-1', null), fields: { ...story('DEMO-1', null).fields, missingFields: ['Story Points', 'Team'] } }],
        missingInfoEpics: [{ key: 'DEMO-EPIC-1', missingFields: ['Assignee', 'Stories'] }],
        dependencyData: { 'DEMO-1': [{ key: 'OTHER-1', storyPoints: 1 }] },
        dependencyLookupCache: { 'DEMO-1': story('DEMO-1', null) },
        excludedCapacityData: { issues: [] },
        projectTrackPhaseData: { untouched: true },
    };
    const updated = patchEngLoadedState(state, new Map(), 'DEMO-1', 'storyPoints', 0).state;

    assert.equal(updated.productTasks[0].fields.customfield_10004, 0);
    assert.deepEqual(updated.missingPlanningInfoTasks[0].fields.missingFields, ['Team']);
    assert.deepEqual(updated.missingInfoEpics[0].missingFields, ['Assignee', 'Stories']);
    assert.deepEqual(updated.dependencyData, {});
    assert.deepEqual(updated.dependencyLookupCache, {});
    assert.equal(updated.excludedCapacityData, null);
    assert.deepEqual(updated.projectTrackPhaseData, { untouched: true });
});

test('flat Epic missing-field summaries retain their top-level shape', async () => {
    const { patchEngLoadedState } = await loadState();
    const state = {
        missingInfoEpics: [{ key: 'DEMO-EPIC-1', assignee: null, missingFields: ['Assignee', 'Stories'] }],
    };

    const updated = patchEngLoadedState(state, new Map(), 'DEMO-EPIC-1', 'assignee', {
        accountId: 'owner-1', displayName: 'Owner',
    }).state;

    assert.deepEqual(updated.missingInfoEpics[0].missingFields, ['Stories']);
    assert.equal(Object.prototype.hasOwnProperty.call(updated.missingInfoEpics[0], 'fields'), false);
});

test('loaded-state patch preserves snapshots and lazy-cache references for groups without the issue', async () => {
    const { patchEngLoadedState } = await loadState();
    const matching = {
        productTasks: [story('DEMO-1', 1)],
        dependencyData: { 'DEMO-1': [{ key: 'OTHER-1', storyPoints: 3 }] },
        dependencyLookupCache: { 'DEMO-1': { key: 'DEMO-1', storyPoints: 1 } },
        excludedCapacityData: { issues: [{ key: 'DEMO-1' }] },
    };
    const unaffectedDependencyData = { 'OTHER-1': [{ key: 'THIRD-1', storyPoints: 5 }] };
    const unaffectedLookup = { 'OTHER-1': { key: 'OTHER-1', storyPoints: 5 } };
    const unaffected = {
        productTasks: [story('OTHER-1', 5)],
        dependencyData: unaffectedDependencyData,
        dependencyLookupCache: unaffectedLookup,
        excludedCapacityData: { issues: [{ key: 'OTHER-1' }] },
    };
    const groups = new Map([['matching', matching], ['unaffected', unaffected]]);

    const updated = patchEngLoadedState({}, groups, 'DEMO-1', 'storyPoints', 2);

    assert.notEqual(updated.groups, groups);
    assert.notEqual(updated.groups.get('matching'), matching);
    assert.equal(updated.groups.get('unaffected'), unaffected);
    assert.equal(updated.groups.get('unaffected').dependencyData, unaffectedDependencyData);
    assert.equal(updated.groups.get('unaffected').dependencyLookupCache, unaffectedLookup);
});

test('late flat dependency lookup reconciles confirmed story points using lookup shape', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const lookupRead = edits.beginRead();
    const mutation = edits.beginMutation('DEMO-1', 'storyPoints', 'mapping-a');
    edits.confirmMutation(mutation, 2);

    const [lookup] = edits.reconcileIssues([{ key: 'DEMO-1', storyPoints: 1.5, status: 'To Do' }], lookupRead);

    assert.equal(lookup.storyPoints, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(lookup, 'customfield_10004'), false);
    edits.finishRead(lookupRead);
});

test('group snapshot commits and restores reconcile confirmed observations', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const mutation = edits.beginMutation('DEMO-1', 'storyPoints', 'mapping-a');
    edits.confirmMutation(mutation, 2);
    const staleSnapshot = {
        productTasks: [story('DEMO-1', 1.5)],
        selectedTasks: { 'DEMO-1': true },
        searchQuery: 'preserved',
    };

    const reconciled = edits.reconcileSnapshot(staleSnapshot);

    assert.equal(reconciled.productTasks[0].fields.customfield_10004, 2);
    assert.deepEqual(reconciled.selectedTasks, staleSnapshot.selectedTasks);
    assert.equal(reconciled.searchQuery, 'preserved');
});

// ---- Planning status/priority reservation registry (issue #250) -------------------------------

function planningStory(key, priority, status = 'To Do') {
    return { key, fields: { priority: { name: priority }, status: { name: status } } };
}

test('planning reservations never advance the aggregate-read generation', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const aggregateRead = edits.beginRead({ aggregate: true });
    const token = edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });

    assert.equal(edits.isCurrentAggregateRead(aggregateRead), true, 'reserving must not invalidate an in-flight aggregate read');
    edits.settlePlanningConfirmed(token, { name: 'Major' });
    assert.equal(edits.isCurrentAggregateRead(aggregateRead), true, 'confirming must not invalidate it either');
    edits.finishRead(aggregateRead);
});

test('one issue/field holds at most one open planning edit; other fields and issues stay free', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const first = edits.reservePlanningEdit({ issueKey: 'demo-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });

    assert.ok(first);
    assert.equal(edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: {}, optimistic: {} }), null);
    assert.ok(edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'status', prior: { name: 'To Do' }, optimistic: { name: 'Done' } }));
    assert.ok(edits.reservePlanningEdit({ issueKey: 'DEMO-2', field: 'priority', prior: { name: 'Low' }, optimistic: { name: 'High' } }));
    assert.equal(edits.reservePlanningEdit({ issueKey: 'DEMO-3', field: 'summary', prior: 'a', optimistic: 'b' }), null, 'only status and priority are planning fields');
    assert.equal(edits.planningPhase('DEMO-1', 'priority'), 'pending');

    edits.settlePlanningUnconfirmed(first);
    assert.equal(edits.planningPhase('DEMO-1', 'priority'), 'locked');
    assert.equal(edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: {}, optimistic: {} }), null, 'a lock blocks another edit');
    const second = edits.reservePlanningEdit({ issueKey: 'DEMO-2', field: 'priority', prior: {}, optimistic: {} });
    assert.equal(second, null, 'DEMO-2 is still pending');
});

test('a confirmed planning edit protects against an older read and yields to a newer one', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const olderRead = edits.beginRead();
    const token = edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });
    edits.settlePlanningConfirmed(token, { name: 'Major' });
    const newerRead = edits.beginRead();

    assert.equal(edits.reconcileIssues([planningStory('DEMO-1', 'Medium')], olderRead)[0].fields.priority.name, 'Major');
    assert.equal(edits.reconcileIssues([planningStory('DEMO-1', 'Low')], newerRead)[0].fields.priority.name, 'Low', 'a read started after the confirmation is authoritative');
    edits.finishRead(olderRead);
    edits.finishRead(newerRead);
});

test('planning fields are never recorded from a read as if they were confirmed', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const firstRead = edits.beginRead();
    edits.reconcileIssues([planningStory('DEMO-1', 'High', 'In Progress')], firstRead);
    const olderRead = edits.beginRead();
    const lateRead = edits.beginRead();
    edits.reconcileIssues([planningStory('DEMO-1', 'Low')], lateRead);

    assert.equal(edits.reconcileIssues([planningStory('DEMO-1', 'Medium')], olderRead)[0].fields.priority.name, 'Medium');
    [firstRead, olderRead, lateRead].forEach(token => edits.finishRead(token));
});

test('the base follows reads that started after the reservation and ignores older ones', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const beforeReservation = edits.beginRead();
    const token = edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });
    const newerRead = edits.beginRead();
    const newestRead = edits.beginRead();

    edits.capturePlanningBases([planningStory('DEMO-1', 'Medium')], beforeReservation);
    edits.capturePlanningBases([planningStory('DEMO-1', 'High')], newestRead);
    edits.capturePlanningBases([planningStory('DEMO-1', 'Low')], newerRead);

    const settled = edits.settlePlanningRejected(token);
    assert.deepEqual(settled.base, { name: 'High' }, 'the newest read started after the reservation wins; a late older read cannot regress it');
    assert.deepEqual(settled.optimistic, { name: 'Major' });
    assert.equal(edits.planningPhase('DEMO-1', 'priority'), null);
});

test('overlay re-applies pending edits and lock priors over a freshly read list, and leaves untouched issues alone', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const pending = edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });
    const locked = edits.reservePlanningEdit({ issueKey: 'DEMO-2', field: 'status', prior: { name: 'To Do' }, optimistic: { name: 'Done' } });
    edits.settlePlanningUnconfirmed(locked);
    const read = [planningStory('DEMO-1', 'Medium'), planningStory('DEMO-2', 'Low', 'To Do'), planningStory('DEMO-3', 'Low')];

    const overlaid = edits.overlayPlanningIssues(read);
    assert.equal(overlaid[0].fields.priority.name, 'Major');
    assert.equal(overlaid[1].fields.status.name, 'To Do', 'a lock shows its provisional prior, not the desired value');
    assert.equal(overlaid[2], read[2], 'issues without an edit keep identity');
    edits.settlePlanningRejected(pending);
    assert.equal(edits.overlayPlanningIssues([read[2]])[0], read[2]);
});

test('a lock releases only on raw evidence from its own scope and never compares values', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const token = edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' }, scope: 'scope-a' });
    edits.settlePlanningUnconfirmed(token);
    const otherKeyOnly = edits.planningEvidence([planningStory('DEMO-9', 'Low')]);
    assert.deepEqual(edits.releasePlanningLocks({ scope: 'scope-a', evidence: otherKeyOnly }), [], 'absence is not evidence');

    const evidence = edits.planningEvidence([planningStory('DEMO-1', 'Medium')]);
    assert.deepEqual(edits.releasePlanningLocks({ scope: 'scope-b', evidence }), [], 'evidence from another scope cannot release it');
    assert.deepEqual(edits.releasePlanningLocks({ scope: 'scope-a', evidence }), [{ issueKey: 'DEMO-1', field: 'priority' }]);
    assert.equal(edits.planningPhase('DEMO-1', 'priority'), null);
    assert.ok(edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: {}, optimistic: {} }), 'the field is editable again');
});

test('a pending evidence set contains only locked entries', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });
    assert.equal(edits.planningEvidence([planningStory('DEMO-1', 'Medium')]).size, 0);
});

test('originals project the pre-edit values, stay stable between changes and notify subscribers', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const revisions = [];
    const unsubscribe = edits.subscribePlanning(revision => revisions.push(revision));
    const token = edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });
    edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'status', prior: { name: 'To Do' }, optimistic: { name: 'Done' } });

    const originals = edits.planningOriginals();
    assert.deepEqual(originals.get('DEMO-1'), { priority: { name: 'Medium' }, status: { name: 'To Do' } });
    assert.equal(edits.planningOriginals(), originals, 'identity is stable until the registry changes');
    edits.abandonPlanningEdit(token);
    assert.equal(edits.planningOriginals().get('DEMO-1').priority.name, 'Medium', 'an abandoned edit keeps its original frozen');
    assert.equal(edits.planningPhase('DEMO-1', 'priority'), 'abandoned');
    unsubscribe();
    edits.settlePlanningRejected(edits.reservePlanningEdit({ issueKey: 'DEMO-7', field: 'status', prior: {}, optimistic: {} }));
    assert.equal(revisions.length, 3, 'two reservations and one abandon notified; nothing after unsubscribing');
});

test('stripping and overlaying a snapshot act only where it still shows the replaced value', async () => {
    const { createEngIssueEditState, stripPendingOverlays, overlaySnapshot } = await loadState();
    const edits = createEngIssueEditState();
    edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });
    const locked = edits.reservePlanningEdit({ issueKey: 'DEMO-2', field: 'status', prior: { name: 'To Do' }, optimistic: { name: 'Done' } });
    edits.settlePlanningUnconfirmed(locked);
    const entries = edits.planningEntries();
    const snapshot = {
        productTasks: [planningStory('DEMO-1', 'Major'), planningStory('DEMO-2', 'Low', 'To Do')],
        epicDetails: {},
    };

    const stripped = stripPendingOverlays(snapshot, entries);
    assert.equal(stripped.productTasks[0].fields.priority.name, 'Medium', 'the optimistic display is removed from the cache');
    assert.equal(stripped.productTasks[1], snapshot.productTasks[1], 'a lock already showing its prior needs no change when it equals the base');

    const newerRead = { productTasks: [planningStory('DEMO-1', 'High'), planningStory('DEMO-2', 'Low', 'To Do')], epicDetails: {} };
    assert.equal(stripPendingOverlays(newerRead, entries), newerRead, 'a value a newer read put there is not overwritten');

    const restored = overlaySnapshot(stripped, entries);
    assert.equal(restored.productTasks[0].fields.priority.name, 'Major', 'a pending edit is shown again after a cache restore');
    assert.equal(restored.productTasks[1].fields.status.name, 'To Do', 'a lock shows its provisional prior');
});

test('guarded list patches apply only where the field still holds the expected name', async () => {
    const { patchEngIssueList } = await loadState();
    const items = [planningStory('DEMO-1', 'Major'), planningStory('DEMO-2', 'High')];

    assert.equal(patchEngIssueList(items, 'DEMO-1', 'priority', { name: 'Medium' }, { name: 'major' })[0].fields.priority.name, 'Medium');
    assert.equal(patchEngIssueList(items, 'DEMO-2', 'priority', { name: 'Medium' }, { name: 'Major' }), items, 'a value that changed meanwhile is kept');
    assert.equal(patchEngIssueList(items, 'DEMO-2', 'priority', { name: 'Medium' })[1].fields.priority.name, 'Medium', 'unguarded patches keep their behavior');
});

test('the mutation scope key keeps its legacy shape', async () => {
    const { buildMutationScopeKey } = await loadState();
    assert.equal(
        buildMutationScopeKey({ boardScopeType: 'sprint', boardScopeSprintId: '', selectedSprint: 3001, activeGroupId: 'group-a', sourceSurface: 'planning' }),
        'sprint|3001|group-a|planning',
    );
    assert.equal(buildMutationScopeKey({ sourceSurface: 'catch_up' }), '|||catch_up');
});

test('a settled write stays unevidenced until a read that started after it carries the field', async () => {
    const { createEngIssueEditState } = await loadState();
    const edits = createEngIssueEditState();
    const readBefore = edits.beginRead();
    const confirmed = edits.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Medium' }, optimistic: { name: 'Major' } });
    edits.settlePlanningConfirmed(confirmed, { name: 'Major' });
    const locked = edits.reservePlanningEdit({ issueKey: 'DEMO-2', field: 'status', prior: { name: 'To Do' }, optimistic: { name: 'Done' } });
    edits.settlePlanningUnconfirmed(locked);

    assert.equal(edits.hasUnevidencedPlanningWrite('DEMO-1', 'priority'), true);
    assert.equal(edits.hasUnevidencedPlanningWrite('DEMO-2', 'status'), true);
    assert.equal(edits.hasUnevidencedPlanningWrite('DEMO-1', 'status'), false);

    edits.notePlanningRawRead([planningStory('DEMO-1', 'Medium')], readBefore);
    assert.equal(edits.hasUnevidencedPlanningWrite('DEMO-1', 'priority'), true, 'a read that started before the write proves nothing');
    const readAfter = edits.beginRead();
    edits.notePlanningRawRead([planningStory('DEMO-1', 'Major')], readAfter);
    assert.equal(edits.hasUnevidencedPlanningWrite('DEMO-1', 'priority'), false);
    assert.equal(edits.hasUnevidencedPlanningWrite('DEMO-2', 'status'), true, 'a read without that issue is not evidence for it');
    [readBefore, readAfter].forEach(token => edits.finishRead(token));
});

// ---- original-value projection and settled-lane order (issue #250 Task 6) ---------------------

test('projecting originals swaps pending issues back to their pre-edit values and keeps everything else', async () => {
    const { projectPlanningOriginals, restorePlanningDisplay } = await loadState();
    const originals = new Map([['DEMO-1', { priority: { name: 'Low' } }]]);
    const display = [planningStory('DEMO-1', 'Highest'), planningStory('DEMO-2', 'High')];

    const projected = projectPlanningOriginals(display, originals);
    assert.equal(projected[0].fields.priority.name, 'Low');
    assert.equal(projected[1], display[1], 'issues without an edit keep identity');
    assert.equal(projectPlanningOriginals(display, new Map()), display, 'no pending edits: identity');
    assert.equal(projectPlanningOriginals(display, undefined), display);

    const filtered = projected.filter(issue => issue.fields.priority.name !== 'High');
    assert.deepEqual(restorePlanningDisplay(filtered, display, originals).map(issue => issue.fields.priority.name), ['Highest'], 'the filtered result maps back to the display issue');
    assert.equal(restorePlanningDisplay(filtered, display, new Map()), filtered);
});

test('settling a key re-sorts its lane by priority, counting other pending issues at their original priority', async () => {
    const { sortLaneForSettledKey } = await loadState();
    const { PRIORITY_ORDER } = await import('../frontend/src/eng/engTaskUtils.js');
    // Load order: C High, A Medium, B Low. A is raised to Highest (settled), B is raised to High (still pending).
    const lane = [planningStory('DEMO-C', 'High'), planningStory('DEMO-A', 'Highest'), planningStory('DEMO-B', 'High')];
    const originals = new Map([['DEMO-A', { priority: { name: 'Medium' } }], ['DEMO-B', { priority: { name: 'Low' } }]]);

    const sorted = sortLaneForSettledKey(lane, 'DEMO-A', originals, PRIORITY_ORDER);
    assert.deepEqual(sorted.map(issue => issue.key), ['DEMO-A', 'DEMO-C', 'DEMO-B'], 'A moves to the top; B, still pending at Low, stays below C');
    assert.equal(sorted[2].fields.priority.name, 'High', 'B keeps its optimistic display');
    assert.equal(lane[0].key, 'DEMO-C', 'the input lane is not mutated');

    assert.equal(sortLaneForSettledKey(lane, 'DEMO-Z', originals, PRIORITY_ORDER), lane, 'a lane without the key is untouched');
    const ordered = [planningStory('DEMO-A', 'Highest'), planningStory('DEMO-C', 'High')];
    assert.equal(sortLaneForSettledKey(ordered, 'DEMO-A', new Map(), PRIORITY_ORDER), ordered, 'already in order: identity');
});

test('equal-priority issues keep their current relative order when a lane is re-sorted', async () => {
    const { sortLaneForSettledKey } = await loadState();
    const { PRIORITY_ORDER } = await import('../frontend/src/eng/engTaskUtils.js');
    const lane = [planningStory('DEMO-1', 'High'), planningStory('DEMO-2', 'Low'), planningStory('DEMO-3', 'High')];
    const sorted = sortLaneForSettledKey(lane, 'DEMO-3', new Map(), PRIORITY_ORDER);
    assert.deepEqual(sorted.map(issue => issue.key), ['DEMO-1', 'DEMO-3', 'DEMO-2']);
});

test('reorderSettledSnapshot re-sorts only the Product and Tech lanes that hold the settled key', async () => {
    const { reorderSettledSnapshot } = await loadState();
    const { PRIORITY_ORDER } = await import('../frontend/src/eng/engTaskUtils.js');
    const snapshot = {
        productTasks: [planningStory('DEMO-C', 'High'), planningStory('DEMO-A', 'Highest')],
        techTasks: [planningStory('DEMO-T', 'Low')],
        loadedProductTasks: [planningStory('DEMO-C', 'High'), planningStory('DEMO-A', 'Highest')],
    };
    const next = reorderSettledSnapshot(snapshot, 'DEMO-A', new Map(), PRIORITY_ORDER);
    assert.deepEqual(next.productTasks.map(issue => issue.key), ['DEMO-A', 'DEMO-C']);
    assert.equal(next.techTasks, snapshot.techTasks, 'a lane without the key keeps identity');
    assert.equal(next.loadedProductTasks, snapshot.loadedProductTasks, 'unsorted source lanes are not reordered');
    assert.equal(reorderSettledSnapshot(null, 'DEMO-A', new Map(), PRIORITY_ORDER), null);
});
