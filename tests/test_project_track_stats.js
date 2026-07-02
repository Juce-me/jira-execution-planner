import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectTrackSprintSeries, summarizeProjectTrackTotals,
  buildProjectTrackBreakdownRows, inScopeEpicKeys, NO_TRACK_LABEL } from '../frontend/src/stats/projectTrackStats.js';

// id !== name on purpose, to prove the join keys on id, not name.
const story = (key, sp, track, sprintId, opts = {}) => ({ key, fields: {
  customfield_10004: sp, epicKey: opts.epicKey || `${key}-EPIC`, epicProjectTrack: track,
  epicAssignee: opts.assignee ? { displayName: opts.assignee } : null,
  teamId: opts.teamId || 'team-a', teamName: opts.teamName, projectKey: opts.projectKey || 'PROD',
  customfield_10101: [{ id: sprintId, name: `Sprint ${sprintId}`, state: 'active' }] } });

// Team mode = story granularity. sprintOrder is ids; range = ids 10 & 20.
const base = { capacitySide: 'product', mode: 'team', excludeAdHoc: false,
  excludeExcludedCapacity: false, techProjectKeys: new Set(['TECH']),
  adHocEpicSet: new Set(), excludedEpicSet: new Set(), sprintOrder: ['10', '20'] };

test('buckets by sprint id (not name); null track -> No track', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 10), story('PROD-2', 3, null, 10)], base);
  assert.deepEqual(s.sprints, ['10']);
  assert.equal(s.sprintLabels['10'], 'Sprint 10');
  assert.equal(s.cells['10']['Committed'], 5);
  assert.equal(s.cells['10'][NO_TRACK_LABEL], 3);
});

test('range filter drops sprints outside sprintOrder', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 10), story('PROD-9', 7, 'Committed', 99)], base);
  assert.deepEqual(s.sprints, ['10']);
  assert.equal(summarizeProjectTrackTotals(s).total, 5);
});

test('capacity side product/tech/both', () => {
  const tasks = [story('PROD-1', 5, 'Committed', 10),
                 story('TECH-1', 8, 'Committed', 10, { projectKey: 'TECH' })];
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, base)).total, 5);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, { ...base, capacitySide: 'tech' })).total, 8);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, { ...base, capacitySide: 'both' })).total, 13);
});

test('exclude toggles drop ad hoc / excluded epics', () => {
  const tasks = [story('PROD-1', 5, 'Committed', 10, { epicKey: 'AD-1' }),
                 story('PROD-2', 4, 'Committed', 10, { epicKey: 'EX-1' })];
  const adHoc = new Set(['AD-1']); const ex = new Set(['EX-1']);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks,
    { ...base, adHocEpicSet: adHoc, excludedEpicSet: ex, excludeAdHoc: true })).total, 4);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks,
    { ...base, adHocEpicSet: adHoc, excludedEpicSet: ex, excludeExcludedCapacity: true })).total, 5);
});

test('epic mode places whole epic SP in its dominant sprint (tie-break by range order)', () => {
  const tasks = [story('PROD-1', 2, 'Committed', 10, { epicKey: 'E1' }),
                 story('PROD-2', 6, 'Committed', 20, { epicKey: 'E1' })];
  const s = buildProjectTrackSprintSeries(tasks, { ...base, mode: 'epic' });
  assert.equal(s.cells['20']['Committed'], 8);
  assert.equal(s.cells['10'], undefined);
});

test('epic mode tie-break: equal SP in two sprints -> later sprintOrder index wins', () => {
  // E1 has 4 SP in sprint 10 and 4 SP in sprint 20 (equal). sprintOrder: ['10','20']
  // -> sprint 20 has the higher index so it wins; all 8 SP land in sprint 20.
  const tasks = [story('PROD-1', 4, 'Committed', 10, { epicKey: 'E1' }),
                 story('PROD-2', 4, 'Committed', 20, { epicKey: 'E1' })];
  const s = buildProjectTrackSprintSeries(tasks, { ...base, mode: 'epic' });
  assert.equal(s.cells['20']['Committed'], 8);
  assert.equal(s.cells['10'], undefined);
});

test('totals aggregate the whole range', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 10), story('PROD-2', 4, 'Committed', 20)], base);
  assert.equal(summarizeProjectTrackTotals(s).total, 9);
});

test('inScopeEpicKeys includes in-range epics and excludes out-of-range epics', () => {
  // sprint '10' is in sprintOrder ['10','20']; sprint '99' is out of range
  const tasks = [
    story('PROD-1', 3, 'Committed', 10, { epicKey: 'E-IN' }),
    story('PROD-2', 5, 'Committed', 99, { epicKey: 'E-OUT' }),
  ];
  const keys = inScopeEpicKeys(tasks, base);
  assert.ok(keys.includes('E-IN'), 'in-range epic should be included');
  assert.ok(!keys.includes('E-OUT'), 'out-of-range epic should be excluded');
  assert.equal(keys.length, 1);
});

test('Team-mode rows use the real team name (not a group label); Epic-mode rows are assignees counted once', () => {
  // Story carries teamId 'team-a' and the real team NAME 'Alpha Team'. The row label
  // must be the real name, and must NOT be a group teamLabels id/value.
  const teamRows = buildProjectTrackBreakdownRows(
    [story('PROD-1', 5, 'Committed', 10, { teamId: 'team-a', teamName: 'Alpha Team' })], base);
  assert.equal(teamRows.rows.find(r => r.label === 'Alpha Team').byTrack['Committed'], 5);
  assert.equal(teamRows.rows.length, 1);
  assert.ok(!teamRows.rows.some(r => r.label === 'team-a'), 'row label must be the team name, not the team id');
  // Falls back to teamId only when the story has no team name.
  const noNameRows = buildProjectTrackBreakdownRows(
    [story('PROD-2', 4, 'Committed', 10, { teamId: 'team-b' })], base);
  assert.equal(noNameRows.rows.find(r => r.label === 'team-b').byTrack['Committed'], 4);
  const epicTasks = [story('S1', 2, 'Committed', 10, { epicKey: 'E1', assignee: 'Dana' }),
                     story('S2', 6, 'Committed', 20, { epicKey: 'E1', assignee: 'Dana' })];
  const epRows = buildProjectTrackBreakdownRows(epicTasks, { ...base, mode: 'epic' });
  assert.equal(epRows.rows.find(r => r.label === 'Dana').byTrack['Committed'], 8);
});
