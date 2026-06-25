const test = require('node:test');
const assert = require('node:assert/strict');

function buildStory({ key, status, sprintId, sprintName } = {}) {
    return {
        key: key || 'STORY-1',
        fields: {
            status: { name: status || 'To Do' },
            sprintId,
            sprintName
        }
    };
}

function classify(epicStories, epic = { key: 'EPIC-1' }) {
    return import('../frontend/src/futurePlanningNeedsStories.mjs').then(({
        classifyFuturePlanningNeedsStories
    }) => classifyFuturePlanningNeedsStories({
        epic,
        epicStories,
        normalizeStatus: (value) => String(value || '').trim().toLowerCase(),
        isTaskInSelectedSprint: (task) => {
            const sprintId = String(task?.fields?.sprintId || '').trim();
            const sprintName = String(task?.fields?.sprintName || '').trim();
            return sprintId === '42' || sprintName === '2026Q2';
        }
    }));
}

test('classifies epics with no child stories as no_stories', async () => {
    const result = await classify([]);
    assert.deepEqual(result, {
        epic: { key: 'EPIC-1' },
        reason: 'no_stories'
    });
});

test('classifies epics with only terminal child stories as only_closed_stories', async () => {
    const result = await classify([
        buildStory({ key: 'STORY-1', status: 'Done' }),
        buildStory({ key: 'STORY-2', status: 'Killed' }),
        buildStory({ key: 'STORY-3', status: 'Incomplete' })
    ]);

    assert.deepEqual(result, {
        epic: { key: 'EPIC-1' },
        reason: 'only_closed_stories'
    });
});

test('classifies epics with open stories outside the selected sprint as stories_in_other_sprint', async () => {
    const result = await classify([
        buildStory({ key: 'STORY-1', status: 'To Do', sprintId: '99', sprintName: '2026Q3' }),
        buildStory({ key: 'STORY-2', status: 'In Progress', sprintId: '100', sprintName: '2026Q4' })
    ]);

    assert.deepEqual(result, {
        epic: { key: 'EPIC-1' },
        reason: 'stories_in_other_sprint'
    });
});

test('returns null when an open story is already in the selected sprint', async () => {
    const result = await classify([
        buildStory({ key: 'STORY-1', status: 'To Do', sprintId: '42', sprintName: '2026Q2' }),
        buildStory({ key: 'STORY-2', status: 'To Do', sprintId: '99', sprintName: '2026Q3' })
    ]);

    assert.equal(result, null);
});

test('returns visible copy for each merged alert reason', async () => {
    const { getFuturePlanningNeedsStoriesReasonText } = await import('../frontend/src/futurePlanningNeedsStories.mjs');

    assert.equal(getFuturePlanningNeedsStoriesReasonText('no_stories'), 'No stories yet for this sprint.');
    assert.equal(getFuturePlanningNeedsStoriesReasonText('only_closed_stories'), 'Only closed stories exist for this epic.');
    assert.equal(getFuturePlanningNeedsStoriesReasonText('stories_in_other_sprint'), 'Open stories exist, but not in the selected sprint.');
});

test('classifies epics with no selected-sprint stories but open stories elsewhere using epic distribution data', async () => {
    const result = await classify([], {
        key: 'EPIC-1',
        totalStories: 2,
        selectedActionableStories: 0,
        openStoriesOutsideSelected: 2
    });

    assert.deepEqual(result, {
        epic: {
            key: 'EPIC-1',
            totalStories: 2,
            selectedActionableStories: 0,
            openStoriesOutsideSelected: 2
        },
        reason: 'stories_in_other_sprint'
    });
});

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();
const noSelectedSprint = () => false;

async function loadTeamModule() {
    return import('../frontend/src/futurePlanningNeedsStories.mjs');
}

test('team needs stories: returns null when the team already has an open selected-sprint story', async () => {
    const { classifyFuturePlanningTeamNeedsStories } = await loadTeamModule();
    const result = classifyFuturePlanningTeamNeedsStories({
        epic: { key: 'EPIC-1', selectedActionableStories: 2, selectedActionableByTeam: { 'team-a': 1, 'team-b': 1 } },
        teamId: 'team-a',
        epicStories: [],
        normalizeStatus,
        isTaskInSelectedSprint: noSelectedSprint
    });
    assert.equal(result, null);
});

test('team needs stories: flags a labeled team with no selected-sprint story when another team has one', async () => {
    const { classifyFuturePlanningTeamNeedsStories } = await loadTeamModule();
    const epic = { key: 'EPIC-1', selectedActionableStories: 2, selectedActionableByTeam: { 'team-a': 2 } };
    const result = classifyFuturePlanningTeamNeedsStories({
        epic,
        teamId: 'team-b',
        epicStories: [],
        normalizeStatus,
        isTaskInSelectedSprint: noSelectedSprint
    });
    assert.deepEqual(result, { epic, reason: 'team_missing_selected' });
});

test('team needs stories: falls back to the epic-wide reason when no team has a selected-sprint story', async () => {
    const { classifyFuturePlanningTeamNeedsStories } = await loadTeamModule();
    const epic = { key: 'EPIC-1', selectedActionableStories: 0, selectedActionableByTeam: {}, totalStories: 0 };
    const result = classifyFuturePlanningTeamNeedsStories({
        epic,
        teamId: 'team-a',
        epicStories: [],
        normalizeStatus,
        isTaskInSelectedSprint: noSelectedSprint
    });
    assert.deepEqual(result, { epic, reason: 'no_stories' });
});

test('team needs stories: falls back to epic-wide classification when per-team data is absent', async () => {
    const { classifyFuturePlanningTeamNeedsStories } = await loadTeamModule();
    const epic = { key: 'EPIC-1', selectedActionableStories: 3 };
    const result = classifyFuturePlanningTeamNeedsStories({
        epic,
        teamId: 'team-a',
        epicStories: [],
        normalizeStatus,
        isTaskInSelectedSprint: noSelectedSprint
    });
    assert.equal(result, null);
});

test('buildNeedsStoriesTeamEntries: one entry per uncovered team, covered teams skipped', async () => {
    const { buildNeedsStoriesTeamEntries } = await loadTeamModule();
    const epic = { key: 'EPIC-1', selectedActionableStories: 2, selectedActionableByTeam: { 'team-a': 2 } };
    const entries = buildNeedsStoriesTeamEntries({
        epic,
        teamInfos: [{ id: 'team-a', name: 'A' }, { id: 'team-b', name: 'B' }, { id: 'team-c', name: 'C' }],
        epicStories: [],
        normalizeStatus,
        isTaskInSelectedSprint: noSelectedSprint
    });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.team.id), ['team-b', 'team-c']);
    assert.equal(entries[0].reason, 'team_missing_selected');
    assert.deepEqual(entries[0].epic, epic);
});

test('returns visible copy for the team-missing-selected reason', async () => {
    const { getFuturePlanningNeedsStoriesReasonText } = await loadTeamModule();
    assert.equal(
        getFuturePlanningNeedsStoriesReasonText('team_missing_selected'),
        'This team has no story for the selected sprint.'
    );
});
