import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectTrackSprintSeries, summarizeProjectTrackTotals,
  buildProjectTrackBreakdownRows, NO_TRACK_LABEL } from '../frontend/src/stats/projectTrackStats.js';

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

test('totals aggregate the whole range', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 10), story('PROD-2', 4, 'Committed', 20)], base);
  assert.equal(summarizeProjectTrackTotals(s).total, 9);
});

test('Team-mode breakdown rows are teams; Epic-mode rows are assignees counted once', () => {
  const teamRows = buildProjectTrackBreakdownRows(
    [story('PROD-1', 5, 'Committed', 10, { teamId: 'team-a' })], base, { teamLabels: { 'team-a': 'Alpha' } });
  assert.equal(teamRows.rows.find(r => r.label === 'Alpha').byTrack['Committed'], 5);
  const epicTasks = [story('S1', 2, 'Committed', 10, { epicKey: 'E1', assignee: 'Dana' }),
                     story('S2', 6, 'Committed', 20, { epicKey: 'E1', assignee: 'Dana' })];
  const epRows = buildProjectTrackBreakdownRows(epicTasks, { ...base, mode: 'epic' }, { teamLabels: {} });
  assert.equal(epRows.rows.find(r => r.label === 'Dana').byTrack['Committed'], 8);
});
