const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const modUrl = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'src', 'eng', 'engTaskUtils.js')
).href;

function epic(key, status, track, taskPriorities) {
  return {
    key,
    epic: { status, projectTrack: track },
    tasks: (taskPriorities || []).map(p => ({ fields: { priority: p ? { name: p } : null } })),
  };
}

test('effective priority is the most urgent child priority', async () => {
  const { getEpicEffectivePriority } = await import(modUrl);
  assert.equal(getEpicEffectivePriority(epic('E1', 'To Do', null, ['Low', 'High', 'Medium'])).name, 'High');
  assert.equal(getEpicEffectivePriority(epic('E2', 'To Do', null, [])).rank, 999);
});

test('status phase rank follows the built-in workflow order', async () => {
  const { getStatusPhaseRank } = await import(modUrl);
  assert.equal(getStatusPhaseRank('To Do'), 0);
  assert.equal(getStatusPhaseRank('Backlog'), 0);
  assert.equal(getStatusPhaseRank('Awaiting Validation'), 2);
  assert.equal(getStatusPhaseRank('In Review'), 4);
  assert.equal(getStatusPhaseRank('Done'), 5);
  assert.equal(getStatusPhaseRank('Released'), 5);
  assert.equal(getStatusPhaseRank('Unknown Status'), 999);
});

test('project track rank honors committed-first vs flexible-first', async () => {
  const { getProjectTrackRank } = await import(modUrl);
  assert.equal(getProjectTrackRank('Committed', true), 0);
  assert.equal(getProjectTrackRank('Flexible', true), 1);
  assert.equal(getProjectTrackRank('Committed', false), 1);
  assert.equal(getProjectTrackRank('', true), 2);
});

test('getProjectTrackEmoji maps values', async () => {
  const { getProjectTrackEmoji } = await import(modUrl);
  assert.equal(getProjectTrackEmoji('Committed'), '🔒');
  assert.equal(getProjectTrackEmoji('Flexible'), '🤷');
  assert.equal(getProjectTrackEmoji(''), '');
});

test('normalizeEngEpicSort + label', async () => {
  const { normalizeEngEpicSort, getEngEpicSortLabel } = await import(modUrl);
  assert.equal(normalizeEngEpicSort('bogus'), 'priority');
  assert.equal(normalizeEngEpicSort('default'), 'priority');
  assert.equal(normalizeEngEpicSort('track-flexible'), 'track-flexible');
  assert.equal(getEngEpicSortLabel('priority'), 'Priority');
});

test('sortEpicGroups: priority orders most-urgent first, then insertion order', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'Done', null, ['Low']),
    epic('B', 'To Do', null, ['Blocker']),
    epic('C', 'In Progress', null, ['Medium']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'priority', { order }).map(g => g.key), ['B', 'C', 'A']);
});

test('sortEpicGroups: status orders by workflow phase then priority', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'Done', null, ['High']),
    epic('B', 'To Do', null, ['Low']),
    epic('C', 'In Progress', null, ['Medium']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'status', { order }).map(g => g.key), ['B', 'C', 'A']);
});

test('sortEpicGroups: track-committed groups committed first then priority', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'To Do', 'Flexible', ['Blocker']),
    epic('B', 'To Do', 'Committed', ['Low']),
    epic('C', 'To Do', 'Committed', ['High']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'track-committed', { order }).map(g => g.key), ['C', 'B', 'A']);
});

test('sortEpicGroups: track-flexible groups flexible first then committed by priority', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'To Do', 'Flexible', ['Blocker']),
    epic('B', 'To Do', 'Committed', ['Low']),
    epic('C', 'To Do', 'Committed', ['High']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'track-flexible', { order }).map(g => g.key), ['A', 'C', 'B']);
});

test('getEpicEffectivePriority: unknown priority name outranks no-priority', async () => {
  const { getEpicEffectivePriority } = await import(modUrl);
  assert.equal(getEpicEffectivePriority(epic('U', 'To Do', null, ['Wacky'])).rank, 998);
  assert.equal(getEpicEffectivePriority(epic('N', 'To Do', null, [])).rank, 999);
});

test('sortEpicGroups: status sorts unmapped last and tiebreaks same phase by priority', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'Mystery Status', null, ['Blocker']),
    epic('B', 'In Progress', null, ['Low']),
    epic('C', 'In Progress', null, ['High']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'status', { order }).map(g => g.key), ['C', 'B', 'A']);
});

test('sortEpicGroups: removed default mode falls back to priority', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [epic('A', 'Done', null, ['Low']), epic('B', 'To Do', null, ['Blocker'])];
  assert.deepEqual(sortEpicGroups(groups, 'default').map(g => g.key), ['B', 'A']);
});

test('sortEpicGroups: priority keeps input order for equal-rank epics', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'Done', null, ['Major']),
    epic('B', 'To Do', null, ['Major']),
    epic('C', 'In Progress', null, ['Major']),
  ];
  assert.deepEqual(sortEpicGroups(groups, 'priority').map(g => g.key), ['A', 'B', 'C']);
});
