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
