import test from 'node:test';
import assert from 'node:assert/strict';
import { alertCallsFor, mergeEpicMissingIssues, mergeEpicScopeEntries, mergeReadinessEpic, replaceEpicStories, recomputeMissingPlanningInfo, shouldHideReadinessGhost } from '../frontend/src/eng/epicRefreshAlerts.js';

const story = (key, fields = {}) => ({ key, fields: { summary: key, status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Story' }, epicKey: 'EPIC-1', teamId: 't1', customfield_10004: 3, customfield_10101: [{ id: 7 }], updated: '1', ...fields } });
const entry = (key, missingFields, fields = {}) => ({ key, fields: { ...story(key).fields, missingFields, ...fields } });

test('Story Points from empty to a value removes the entry when nothing else is missing', () => {
    const held = [entry('S-1', ['Story Points'], { customfield_10004: null })];
    assert.deepEqual(recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 3 })], epicKey: 'EPIC-1' }), []);
});

test('an entry keeps only the names that are still missing and refreshes its stale fields', () => {
    const held = [entry('S-1', ['Story Points', 'Team'], { customfield_10004: null, teamId: null, summary: 'old' })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 3, teamId: null, summary: 'new' })], epicKey: 'EPIC-1' });
    assert.deepEqual(out[0].fields.missingFields, ['Team']);
    assert.equal(out[0].fields.summary, 'new');
});

test('a refreshed story with Story Points 0 is flagged, never "Assignee"', () => {
    const held = [entry('S-1', ['Team'], { teamId: null })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 0, teamId: null })], epicKey: 'EPIC-1' });
    assert.deepEqual(out[0].fields.missingFields, ['Story Points', 'Team']);
});

test('a refreshed story that lost its sprint gains the Sprint name, in the endpoint order', () => {
    const held = [entry('S-1', ['Story Points'], { customfield_10004: null })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 0, customfield_10101: [] })], epicKey: 'EPIC-1' });
    assert.deepEqual(out[0].fields.missingFields, ['Sprint', 'Story Points']);
});

test('terminal statuses drop the entry (the endpoint excludes Killed, Done and Postponed)', () => {
    for (const name of ['Killed', 'Done', 'Postponed']) {
        const held = [entry('S-1', ['Story Points'], { customfield_10004: null })];
        assert.deepEqual(recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: null, status: { name } })], epicKey: 'EPIC-1' }), [], name);
    }
});

test('entries whose story was not refreshed, and other epics, are untouched and identity is kept', () => {
    const held = [entry('S-1', ['Story Points'], { customfield_10004: null }), entry('S-9', ['Team'], { epicKey: 'EPIC-2', teamId: null })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-2')], epicKey: 'EPIC-1' });
    assert.equal(out, held);
});

test('an entry of another epic is untouched even when a refreshed story shares its key', () => {
    const held = [entry('S-9', ['Team'], { epicKey: 'EPIC-2', teamId: null })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-9', { teamId: 't1' })], epicKey: 'EPIC-1' });
    assert.equal(out, held);
});

test('an unchanged refreshed story keeps the same entry object', () => {
    const held = [entry('S-1', ['Story Points'], { customfield_10004: null })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: null })], epicKey: 'EPIC-1' });
    assert.equal(out, held);
});

test('untouched entries keep their object identity when a sibling changes', () => {
    const keep = entry('S-2', ['Team'], { teamId: null });
    const held = [entry('S-1', ['Story Points'], { customfield_10004: null }), keep];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 0 }), story('S-2', { teamId: null })], epicKey: 'EPIC-1' });
    assert.equal(out.length, 2);
    assert.equal(out[1], keep);
    assert.deepEqual(out[0].fields.missingFields, ['Story Points']);
});

test('a flat entry (no nested fields.missingFields) is rewritten in its own shape', () => {
    const held = [{ key: 'S-1', fields: { ...story('S-1').fields, customfield_10004: null }, missingFields: ['Story Points'] }];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 0, teamId: null })], epicKey: 'EPIC-1' });
    assert.deepEqual(out[0].missingFields, ['Story Points', 'Team']);
    assert.equal(out[0].fields.missingFields, undefined);
    assert.equal(recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 5 })], epicKey: 'EPIC-1' }).length, 0);
});

test('a ghost is hidden once an actionable story for that team exists, but not for blocked, done, killed or incomplete ones', () => {
    assert.equal(shouldHideReadinessGhost({ epicKey: 'EPIC-1', teamId: 't1', stories: [story('S-1')] }), true);
    for (const name of ['Blocked', 'Done', 'Killed', 'Incomplete']) {
        assert.equal(shouldHideReadinessGhost({ epicKey: 'EPIC-1', teamId: 't1', stories: [story('S-1', { status: { name } })] }), false, name);
    }
    assert.equal(shouldHideReadinessGhost({ epicKey: 'EPIC-1', teamId: 't2', stories: [story('S-1')] }), false);
    assert.equal(shouldHideReadinessGhost({ epicKey: 'EPIC-2', teamId: 't1', stories: [story('S-1')] }), false);
});

test('the hierarchy drops a Stories Required ghost the held stories already cover, in Catch Up and Planning', async () => {
    const { buildEngWorkHierarchy } = await import('../frontend/src/eng/engWorkHierarchy.js');
    const sprint = { groupId: 'g1', id: '42', name: 'Sprint 42', state: 'active' };
    const group = stories => ({ key: 'EPIC-1', epic: { key: 'EPIC-1', summary: 'E', projectClass: 'product', projectTrack: 'Committed' }, tasks: stories, storyPoints: 3 });
    const snapshot = { schemaVersion: 1, complete: true, scope: { groupId: 'g1', sprintId: '42', sprintName: 'Sprint 42', sprintState: 'active' },
        epics: [{ key: 'EPIC-1', summary: 'E', status: { name: 'To Do' }, priority: { name: 'Medium' }, projectTrack: 'Committed', projectClass: 'product',
            missingTeams: [{ id: 't1', name: 'T1', reason: 'no_stories' }, { id: 't2', name: 'T2', reason: 'no_stories' }] }] };
    for (const mode of ['catch_up', 'planning']) {
        const covered = buildEngWorkHierarchy({ mode, sprint, storyEpicGroups: [group([story('S-1')])], readinessSnapshot: snapshot });
        assert.deepEqual(covered.alertTargets.map(target => target.team.id), ['t2'], mode);
        assert.deepEqual(covered.epicGroups[0].rows.filter(row => row.kind === 'story_requirement').map(row => row.team.id), ['t2'], mode);
        const blocked = buildEngWorkHierarchy({ mode, sprint, storyEpicGroups: [group([story('S-1', { status: { name: 'Blocked' } })])], readinessSnapshot: snapshot });
        assert.deepEqual(blocked.alertTargets.map(target => target.team.id), ['t1', 't2'], mode);
    }
});

// Task 11: scope-based alerts for one epic.
const scopeEpic = (key, status = 'To Do', extra = {}) => ({ key, summary: key, status: { name: status }, ...extra });
const update = (overrides = {}) => ({
    epicKey: 'EPIC-1', changedKeys: [], silentKeys: [], addedKeys: [], removedKeys: [], changedFieldsByKey: {}, epicChanged: false, epicSilent: false, ...overrides,
});
const changedStory = (...fields) => ({ changedKeys: ['S-1'], changedFieldsByKey: { 'S-1': fields } });
const catchUp = { isFutureSprint: false, isCatchUp: true };

test('mergeEpicScopeEntries replaces the entry for the epic key in place and keeps the other epics', () => {
    const other = scopeEpic('EPIC-2');
    const held = [scopeEpic('EPIC-1', 'To Do'), other];
    const out = mergeEpicScopeEntries({ held, incoming: [scopeEpic('EPIC-1', 'In Progress')], epicKey: 'EPIC-1' });
    assert.deepEqual(out.map(epic => [epic.key, epic.status.name]), [['EPIC-1', 'In Progress'], ['EPIC-2', 'To Do']]);
    assert.equal(out[1], other);
});

test('mergeEpicScopeEntries appends an epic that was not held and deletes one the lane no longer returns', () => {
    const held = [scopeEpic('EPIC-2')];
    assert.deepEqual(mergeEpicScopeEntries({ held, incoming: [scopeEpic('EPIC-1')], epicKey: 'EPIC-1' }).map(epic => epic.key), ['EPIC-2', 'EPIC-1']);
    assert.deepEqual(mergeEpicScopeEntries({ held: [scopeEpic('EPIC-1'), scopeEpic('EPIC-2')], incoming: [], epicKey: 'EPIC-1' }).map(epic => epic.key), ['EPIC-2']);
});

test('mergeEpicScopeEntries keeps the array identity when nothing changes and ignores entries of other epics in the incoming list', () => {
    const held = [scopeEpic('EPIC-1', 'To Do', { openChildCount: 2 }), scopeEpic('EPIC-2')];
    assert.equal(mergeEpicScopeEntries({ held, incoming: [scopeEpic('EPIC-1', 'To Do', { openChildCount: 2 })], epicKey: 'EPIC-1' }), held);
    assert.equal(mergeEpicScopeEntries({ held, incoming: [scopeEpic('EPIC-1', 'To Do', { openChildCount: 2 }), scopeEpic('EPIC-9')], epicKey: 'EPIC-1' }), held);
    const unchanged = [scopeEpic('EPIC-2')];
    assert.equal(mergeEpicScopeEntries({ held: unchanged, incoming: [], epicKey: 'EPIC-1' }), unchanged);
});

test('mergeEpicScopeEntries can be told not to delete (an empty ready-to-close answer is not proof the epic left scope)', () => {
    const held = [scopeEpic('EPIC-1')];
    assert.equal(mergeEpicScopeEntries({ held, incoming: [], epicKey: 'EPIC-1', deleteWhenAbsent: false }), held);
});

test('replaceEpicStories swaps only the epic story copies and keeps identity when equal', () => {
    const copy = (key, epicKey, status = 'To Do') => ({ key, fields: { epicKey, status: { name: status } } });
    const held = [copy('S-1', 'EPIC-1'), copy('S-2', 'EPIC-2')];
    assert.equal(replaceEpicStories({ held, incoming: [copy('S-1', 'EPIC-1')], epicKey: 'EPIC-1' }), held);
    const out = replaceEpicStories({ held, incoming: [copy('S-1', 'EPIC-1', 'Done'), copy('S-3', 'EPIC-1')], epicKey: 'EPIC-1' });
    assert.deepEqual(out.map(item => [item.key, item.fields.status.name]), [['S-2', 'To Do'], ['S-1', 'Done'], ['S-3', 'To Do']]);
    assert.deepEqual(replaceEpicStories({ held, incoming: [], epicKey: 'EPIC-1' }).map(item => item.key), ['S-2']);
});

test('replaceEpicStories: an unconfirmed empty answer keeps the held copies and the array identity (partial data, MRT019)', () => {
    const copy = (key, epicKey) => ({ key, fields: { epicKey, status: { name: 'Done' } } });
    const held = [copy('S-1', 'EPIC-1'), copy('S-2', 'EPIC-2')];
    assert.equal(replaceEpicStories({ held, incoming: [], epicKey: 'EPIC-1', emptyConfirmed: false }), held);
    assert.equal(replaceEpicStories({ held, incoming: undefined, epicKey: 'EPIC-1', emptyConfirmed: false }), held);
});

test('replaceEpicStories: a confirmed empty answer deletes only that epic\'s copies', () => {
    const copy = (key, epicKey) => ({ key, fields: { epicKey, status: { name: 'Done' } } });
    const held = [copy('S-1', 'EPIC-1'), copy('S-2', 'EPIC-2')];
    assert.deepEqual(replaceEpicStories({ held, incoming: [], epicKey: 'EPIC-1', emptyConfirmed: true }).map(item => item.key), ['S-2']);
});

test('replaceEpicStories: a non-empty answer replaces regardless of the confirmation', () => {
    const copy = (key, epicKey, status = 'Done') => ({ key, fields: { epicKey, status: { name: status } } });
    const held = [copy('S-1', 'EPIC-1'), copy('S-2', 'EPIC-2')];
    const out = replaceEpicStories({ held, incoming: [copy('S-3', 'EPIC-1', 'To Do')], epicKey: 'EPIC-1', emptyConfirmed: false });
    assert.deepEqual(out.map(item => item.key), ['S-2', 'S-3']);
});

test('alertCallsFor: Story Points, assignee, summary, priority and updated-only changes need no alert call', () => {
    for (const field of ['storyPoints', 'assignee', 'summary', 'priority']) {
        assert.deepEqual(alertCallsFor(update(changedStory(field)), catchUp), [], field);
    }
    assert.deepEqual(alertCallsFor(update({ silentKeys: ['S-1'] }), catchUp), []);
    assert.deepEqual(alertCallsFor(update(), catchUp), []);
});

test('alertCallsFor: a story status change re-checks Ready to Close, the epic alert object and Stories Required', () => {
    assert.deepEqual(alertCallsFor(update(changedStory('status')), catchUp), ['readyToClose', 'epicAlerts', 'readiness']);
});

test('alertCallsFor: a story added, removed or moved to another sprint re-checks every epic-level alert', () => {
    const all = ['readyToClose', 'epicAlerts', 'missingInfo', 'readiness'];
    assert.deepEqual(alertCallsFor(update({ addedKeys: ['S-2'] }), catchUp), all);
    assert.deepEqual(alertCallsFor(update({ removedKeys: ['S-2'] }), catchUp), all);
    assert.deepEqual(alertCallsFor(update(changedStory('sprint')), catchUp), all);
    assert.deepEqual(alertCallsFor(update({ addedKeys: ['S-2'] }), { isFutureSprint: true, isCatchUp: true }), ['readyToClose', 'epicAlerts', 'missingInfo', 'backlog', 'readiness']);
});

test('alertCallsFor: a story team change re-checks Missing Info and readiness only', () => {
    assert.deepEqual(alertCallsFor(update(changedStory('teamId')), catchUp), ['missingInfo', 'readiness']);
});

test('alertCallsFor: an epic status, assignee or updated-only change re-checks the epic alert object', () => {
    assert.deepEqual(alertCallsFor(update({ epicChanged: true, epicChangedFields: ['status'] }), catchUp), ['epicAlerts']);
    assert.deepEqual(alertCallsFor(update({ epicChanged: true, epicChangedFields: ['assignee'] }), catchUp), ['epicAlerts']);
    assert.deepEqual(alertCallsFor(update({ epicSilent: true }), catchUp), ['epicAlerts']);
    assert.deepEqual(alertCallsFor(update({ epicChanged: true, epicChangedFields: ['summary', 'priority'] }), catchUp), []);
});

test('alertCallsFor: a future sprint always includes the epic alert object once anything changed', () => {
    const future = { isFutureSprint: true, isCatchUp: true };
    assert.deepEqual(alertCallsFor(update(changedStory('storyPoints')), future), ['epicAlerts']);
    assert.deepEqual(alertCallsFor(update({ epicSilent: true }), future), ['epicAlerts', 'backlog']);
    assert.deepEqual(alertCallsFor(update(), future), []);
});

test('alertCallsFor: Planning never re-checks alerts', () => {
    const planning = { isFutureSprint: false, isCatchUp: false };
    assert.deepEqual(alertCallsFor(update({ addedKeys: ['S-2'], ...changedStory('status') }), planning), []);
    assert.deepEqual(alertCallsFor(update({ epicSilent: true }), { isFutureSprint: true, isCatchUp: false }), []);
});

// ---- Task 12: missing-info, backlog and Stories Required for one epic ----

const readinessEpic = (key, extra = {}) => ({ key, summary: key, status: { name: 'To Do' }, assignee: { displayName: 'Ann' }, projectTrack: 'Committed', initiative: { key: 'INI-1', summary: 'Init' }, projectClass: 'product', missingTeams: [{ id: 't1', name: 'T1', reason: 'no_stories' }], ...extra });
const snapshotOf = (...epics) => ({ schemaVersion: 1, complete: true, scope: { groupId: 'g1', sprintId: '42' }, epics });
const payloadOf = (...epics) => ({ schemaVersion: 1, complete: true, scope: { groupId: 'g1', sprintId: '42' }, epics });

test('mergeReadinessEpic replaces the epic entry in place and keeps the other epics and the scope', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'), readinessEpic('E-2'));
    const out = mergeReadinessEpic({ snapshot, epicPayload: payloadOf(readinessEpic('E-1', { missingTeams: [{ id: 't2', name: 'T2', reason: 'team_uncovered' }] })), epicKey: 'E-1' });
    assert.deepEqual(out.epics.map(epic => epic.key), ['E-1', 'E-2']);
    assert.equal(out.epics[0].missingTeams[0].id, 't2');
    assert.equal(out.epics[1], snapshot.epics[1]);
    assert.equal(out.scope, snapshot.scope);
});

test('mergeReadinessEpic appends an epic the snapshot did not hold and deletes one the payload no longer lists', () => {
    const snapshot = snapshotOf(readinessEpic('E-2'));
    const appended = mergeReadinessEpic({ snapshot, epicPayload: payloadOf(readinessEpic('E-1')), epicKey: 'E-1' });
    assert.deepEqual(appended.epics.map(epic => epic.key), ['E-2', 'E-1']);
    const deleted = mergeReadinessEpic({ snapshot: appended, epicPayload: payloadOf(), epicKey: 'E-1' });
    assert.deepEqual(deleted.epics.map(epic => epic.key), ['E-2']);
});

test('mergeReadinessEpic ignores entries of other epics in the payload and keeps the snapshot identity when equal', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'), readinessEpic('E-2'));
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: payloadOf(readinessEpic('E-1')), epicKey: 'E-1' }), snapshot);
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: payloadOf(readinessEpic('E-1'), readinessEpic('E-9')), epicKey: 'E-1' }), snapshot);
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: payloadOf(readinessEpic('E-2', { summary: 'other' })), epicKey: 'E-1' }).epics.length, 1);
});

test('mergeReadinessEpic with no payload keeps the entry (a failed or skipped call never deletes)', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'));
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1' }), snapshot);
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: undefined, epicKey: 'E-1' }), snapshot);
});

test('mergeReadinessEpic: stale readiness assignee, track and initiative never shadow cleared epic details', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'), readinessEpic('E-2'));
    const out = mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: { key: 'E-1', summary: 'E-1', assignee: null, projectTrack: null, initiative: null } });
    assert.equal(out.epics[0].assignee, null);
    assert.equal(out.epics[0].projectTrack, '');
    assert.equal(out.epics[0].initiative, null);
    assert.equal(out.epics[0].missingTeams, snapshot.epics[0].missingTeams);
    assert.equal(out.epics[1], snapshot.epics[1]);
});

test('mergeReadinessEpic: refreshed details that omit the initiative key clear the held initiative (fetch_epic_details_bulk omits it when none)', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'));
    const out = mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: { key: 'E-1', summary: 'E-1', assignee: { displayName: 'Ann' }, projectTrack: 'Committed' } });
    assert.equal(out.epics[0].initiative, null);
    assert.equal(out.epics[0].assignee, snapshot.epics[0].assignee);
});

test('mergeReadinessEpic: missing epic details change nothing, even for an absent initiative (failed refresh, MRT019)', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'));
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: undefined }), snapshot);
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: null }), snapshot);
});

test('mergeReadinessEpic: epic details with an initiative replace a different held initiative, an equal one keeps identity, an explicit null clears', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'));
    const replaced = mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: { key: 'E-1', initiative: { key: 'INI-2', summary: 'New' } } });
    assert.deepEqual(replaced.epics[0].initiative, { key: 'INI-2', summary: 'New' });
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: { key: 'E-1', initiative: { key: 'INI-1', summary: 'Init' } } }), snapshot);
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: { key: 'E-1', initiative: null } }).epics[0].initiative, null);
});

test('mergeReadinessEpic: non-empty or absent epic details leave the readiness entry alone and keep identity', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'));
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: { key: 'E-1', assignee: { displayName: 'Bob' }, projectTrack: 'Flexible', initiative: { key: 'INI-1', summary: 'Init' } } }), snapshot);
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-1', epicDetails: { key: 'E-1', summary: 'x', initiative: { key: 'INI-1', summary: 'Init' } } }), snapshot);
    assert.equal(mergeReadinessEpic({ snapshot, epicPayload: null, epicKey: 'E-9', epicDetails: { assignee: null } }), snapshot);
});

test('mergeReadinessEpic: a fresh payload entry is also cleared where the epic details are cleared', () => {
    const snapshot = snapshotOf(readinessEpic('E-1'));
    const out = mergeReadinessEpic({ snapshot, epicPayload: payloadOf(readinessEpic('E-1')), epicKey: 'E-1', epicDetails: { assignee: null } });
    assert.equal(out.epics[0].assignee, null);
    assert.equal(out.epics[0].projectTrack, 'Committed');
});

test('mergeReadinessEpic never throws on a missing snapshot', () => {
    assert.equal(mergeReadinessEpic({ snapshot: null, epicPayload: payloadOf(readinessEpic('E-1')), epicKey: 'E-1' }), null);
});

test('mergeEpicMissingIssues upserts the epic issues by key and keeps other epics and unchanged identity', () => {
    const held = [entry('S-1', ['Team'], { teamId: null }), entry('S-9', ['Team'], { epicKey: 'EPIC-2', teamId: null })];
    const same = mergeEpicMissingIssues({ held, incoming: [entry('S-1', ['Team'], { teamId: null })], epicKey: 'EPIC-1' });
    assert.equal(same, held);
    const next = mergeEpicMissingIssues({ held, incoming: [entry('S-1', ['Team', 'Story Points'], { teamId: null, customfield_10004: null }), entry('S-2', ['Sprint'], { customfield_10101: [] })], epicKey: 'EPIC-1' });
    assert.deepEqual(next.map(item => item.key), ['S-1', 'S-9', 'S-2']);
    assert.deepEqual(next[0].fields.missingFields, ['Team', 'Story Points']);
    assert.equal(next[1], held[1]);
});

test('mergeEpicMissingIssues ignores incoming entries of another epic', () => {
    const held = [entry('S-1', ['Team'], { teamId: null })];
    assert.equal(mergeEpicMissingIssues({ held, incoming: [entry('S-9', ['Team'], { epicKey: 'EPIC-2', teamId: null })], epicKey: 'EPIC-1' }), held);
});

test('mergeEpicMissingIssues: an absent issue is kept (partial data, MRT019) unless the epic left the scope', () => {
    const held = [entry('S-1', ['Team'], { teamId: null }), entry('S-9', ['Team'], { epicKey: 'EPIC-2', teamId: null })];
    assert.equal(mergeEpicMissingIssues({ held, incoming: [], epicKey: 'EPIC-1' }), held);
    const gone = mergeEpicMissingIssues({ held, incoming: [], epicKey: 'EPIC-1', epicInScope: false });
    assert.deepEqual(gone.map(item => item.key), ['S-9']);
    assert.equal(mergeEpicMissingIssues({ held: [held[1]], incoming: [], epicKey: 'EPIC-1', epicInScope: false }).length, 1);
});
