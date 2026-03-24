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
