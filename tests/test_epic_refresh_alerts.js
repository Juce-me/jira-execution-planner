import test from 'node:test';
import assert from 'node:assert/strict';
import { recomputeMissingPlanningInfo, shouldHideReadinessGhost } from '../frontend/src/eng/epicRefreshAlerts.js';

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
