import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectTrackSprintSeries, summarizeProjectTrackTotals,
  buildProjectTrackBreakdownRows, buildProjectTrackColumnSplit, inScopeEpicKeys, NO_TRACK_LABEL,
  NO_EPIC_COLUMN_ID } from '../frontend/src/stats/projectTrackStats.js';

// id !== name on purpose, to prove the join keys on id, not name.
const story = (key, sp, track, sprintId, opts = {}) => ({ key, fields: {
  customfield_10004: sp, epicKey: opts.noEpic ? null : (opts.epicKey || `${key}-EPIC`), epicProjectTrack: track,
  epicAssignee: opts.assignee ? { displayName: opts.assignee } : null,
  epicStatus: opts.noEpic ? null : (opts.epicStatus || null),
  status: opts.status ? { name: opts.status } : { name: 'To Do' },
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

test('Project Track excludes stories whose parent epic is Done, Killed, or Incomplete', () => {
  const tasks = [
    story('PROD-OPEN', 5, 'Committed', 10, { epicKey: 'E-OPEN', epicStatus: 'In Progress' }),
    story('PROD-DONE', 7, 'Committed', 10, { epicKey: 'E-DONE', epicStatus: 'Done' }),
    story('PROD-KILLED', 11, null, 10, { epicKey: 'E-KILLED', epicStatus: ' killed ' }),
    story('PROD-INCOMPLETE', 13, 'Flexible', 10, { epicKey: 'E-INCOMPLETE', epicStatus: 'Incomplete' }),
  ];

  const epicOpts = { ...base, mode: 'epic' };
  const series = buildProjectTrackSprintSeries(tasks, epicOpts);
  const breakdown = buildProjectTrackBreakdownRows(tasks, epicOpts);

  assert.equal(summarizeProjectTrackTotals(series).total, 5);
  assert.deepEqual(inScopeEpicKeys(tasks, epicOpts), ['E-OPEN']);
  assert.equal(breakdown.rows.reduce((total, row) => total + row.total, 0), 5);
});

test('Team mode keeps Done and Incomplete epics and drops Killed epics and Killed stories', () => {
  const tasks = [
    story('PROD-OPEN', 5, 'Committed', 10, { epicKey: 'E-OPEN', epicStatus: 'In Progress' }),
    story('PROD-DONE', 7, 'Committed', 10, { epicKey: 'E-DONE', epicStatus: 'Done' }),
    story('PROD-KILLED-EPIC', 11, null, 10, { epicKey: 'E-KILLED', epicStatus: ' killed ' }),
    story('PROD-INCOMPLETE', 13, 'Flexible', 10, { epicKey: 'E-INCOMPLETE', epicStatus: 'Incomplete' }),
    story('PROD-KILLED-STORY', 17, 'Committed', 10, { epicKey: 'E-OPEN', epicStatus: 'In Progress', status: ' Killed' }),
  ];

  const series = buildProjectTrackSprintSeries(tasks, base);
  const breakdown = buildProjectTrackBreakdownRows(tasks, base);

  assert.equal(summarizeProjectTrackTotals(series).total, 25);
  assert.deepEqual(summarizeProjectTrackTotals(series).byTrack, { Committed: 12, Flexible: 13 });
  assert.equal(breakdown.rows.reduce((total, row) => total + row.total, 0), 25);
  assert.deepEqual(inScopeEpicKeys(tasks, base).sort(), ['E-DONE', 'E-INCOMPLETE', 'E-OPEN']);
});

const board = [
  { id: 'col-todo', name: 'Backlog', colour: '#8c8c8c', statuses: ['To Do'] },
  { id: 'col-build', name: 'Build', colour: '#597ef7', statuses: ['In Progress', 'Review'] },
  { id: 'col-done', name: 'Done', colour: '#52c41a', statuses: ['Done', 'Incomplete'] },
];
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('column split sums each team track by the parent epic Board column', () => {
  const tasks = [
    story('A-1', 2.5, 'Committed', 10, { teamId: 'team-a', teamName: 'Alpha', epicKey: 'E1', epicStatus: 'In Progress' }),
    story('A-2', 3, 'Committed', 10, { teamId: 'team-a', teamName: 'Alpha', epicKey: 'E2', epicStatus: 'Done' }),
    story('A-3', 1.25, 'Flexible', 10, { teamId: 'team-a', teamName: 'Alpha', epicKey: 'E3', epicStatus: 'Unlisted' }),
    story('A-4', 4, 'Flexible', 10, { teamId: 'team-a', teamName: 'Alpha', epicKey: 'E4', epicStatus: null }),
    story('B-1', 6, null, 20, { teamId: 'team-b', teamName: 'Beta', epicKey: 'E5', epicStatus: 'Review' }),
    story('B-2', 1, 'Committed', 20, { teamId: 'team-b', teamName: 'Beta', noEpic: true }),
    story('B-3', 0, 'Committed', 20, { teamId: 'team-b', teamName: 'Beta', epicKey: 'E6', epicStatus: 'Done' }),
    story('B-4', 9, 'Committed', 20, { teamId: 'team-b', teamName: 'Beta', epicKey: 'E7', epicStatus: 'Killed' }),
  ];
  const split = buildProjectTrackColumnSplit(tasks, base, board);

  assert.deepEqual(split.columns.map((c) => c.id), ['col-todo', 'col-build', 'col-done', NO_EPIC_COLUMN_ID]);
  assert.equal(split.columns.at(-1).name, 'No Epic');
  assert.deepEqual(split.rows['team-a'].Committed, { 'col-build': 2.5, 'col-done': 3 });
  assert.deepEqual(split.rows['team-a'].Flexible, { 'col-todo': 5.25 });
  assert.deepEqual(split.rows['team-b'][NO_TRACK_LABEL], { 'col-build': 6 });
  assert.deepEqual(split.rows['team-b'].Committed, { [NO_EPIC_COLUMN_ID]: 1 });
  assert.deepEqual(split.all.Committed, { 'col-build': 2.5, 'col-done': 3, [NO_EPIC_COLUMN_ID]: 1 });

  // Conservation against the existing breakdown and totals helpers.
  const breakdown = buildProjectTrackBreakdownRows(tasks, base);
  for (const row of breakdown.rows) {
    for (const [track, sp] of Object.entries(row.byTrack)) {
      const parts = Object.values(split.rows[row.id][track] || {});
      assert.ok(close(parts.reduce((a, b) => a + b, 0), sp), `${row.id} ${track}`);
    }
  }
  const totals = summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, base)).byTrack;
  for (const [track, sp] of Object.entries(totals)) {
    assert.ok(close(Object.values(split.all[track]).reduce((a, b) => a + b, 0), sp), track);
  }
});

test('column split omits No Epic when every story has an epic and does not mutate input', () => {
  const tasks = [story('A-1', 2, 'Committed', 10, { epicStatus: 'Done' })];
  const snapshot = JSON.stringify(tasks);
  const split = buildProjectTrackColumnSplit(tasks, base, board);
  assert.deepEqual(split.columns.map((c) => c.id), ['col-todo', 'col-build', 'col-done']);
  assert.equal(JSON.stringify(tasks), snapshot);
});

test('column split coerces off-palette colours to the default column colour', () => {
  const split = buildProjectTrackColumnSplit([story('A-1', 2, 'Committed', 10, { epicStatus: 'To Do' })], base,
    [{ id: 'col-x', name: 'X', colour: '#123456', statuses: ['To Do'] }]);
  assert.equal(split.columns[0].colour, '#8c8c8c');
});

test('column split falls back to the default To Do / In Progress / Done board with stable ids', () => {
  const tasks = [
    story('A-1', 2, 'Committed', 10, { epicStatus: 'In Progress' }),
    story('A-2', 3, 'Committed', 10, { epicStatus: 'Done' }),
    story('A-3', 4, 'Flexible', 10, { epicStatus: 'Analysis' }),
  ];
  const first = buildProjectTrackColumnSplit(tasks, base, []);
  const second = buildProjectTrackColumnSplit(tasks, base, [{ id: 'col-a', name: 'A', statuses: [] }]);

  assert.deepEqual(first.columns.map((c) => c.name), ['To Do', 'In Progress', 'Done']);
  assert.deepEqual(first.columns.map((c) => c.id), ['default-to-do', 'default-in-progress', 'default-done']);
  assert.deepEqual(second.columns, first.columns);
  assert.deepEqual(first.rows['team-a'].Committed, { 'default-in-progress': 2, 'default-done': 3 });
  assert.deepEqual(first.rows['team-a'].Flexible, { 'default-to-do': 4 });
});

test('default board keeps only phases that hold an observed status', () => {
  const split = buildProjectTrackColumnSplit([story('A-1', 2, 'Committed', 10, { epicStatus: 'Done' })], base, null);
  assert.deepEqual(split.columns.map((c) => c.name), ['Done']);
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

test('Epic-mode assignee rows retain the epic keys behind each Project Track segment', () => {
  const tasks = [
    story('S1', 2, null, 10, { epicKey: 'E-NONE', assignee: 'Dana' }),
    story('S2', 3, 'Committed', 10, { epicKey: 'E-COMMITTED', assignee: 'Dana' }),
    story('S3', 5, null, 20, { epicKey: 'E-NONE', assignee: 'Dana' }),
  ];

  const rows = buildProjectTrackBreakdownRows(tasks, { ...base, mode: 'epic' }).rows;
  const dana = rows.find((row) => row.label === 'Dana');

  assert.deepEqual(dana.epicKeysByTrack[NO_TRACK_LABEL], ['E-NONE']);
  assert.deepEqual(dana.epicKeysByTrack.Committed, ['E-COMMITTED']);
});

test('default board places status-less epics in To Do when no epic status is observed', () => {
  const split = buildProjectTrackColumnSplit([story('A-1', 2, 'Committed', 10, { epicStatus: null })], base, []);
  assert.deepEqual(split.columns.map((c) => c.id), ['default-to-do']);
  assert.deepEqual(split.rows['team-a'].Committed, { 'default-to-do': 2 });
});
