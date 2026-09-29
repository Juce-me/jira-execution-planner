const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engAlertFilters.js');
}

function task(key, summary, epicKey = 'EPIC-1') {
    return {
        key,
        fields: {
            summary,
            epicKey,
            assignee: { displayName: 'Story Owner' },
        },
    };
}

function epic(key, summary, overrides = {}) {
    return {
        key,
        summary,
        assignee: { displayName: 'Epic Owner' },
        initiative: { key: 'INIT-1', summary: 'Portfolio North Star' },
        ...overrides,
    };
}

test('search filters every ENG alert collection with the same Story and Epic hierarchy fields', async () => {
    const { filterEngAlertCollections } = await loadModule();
    const matchingTask = task('STORY-1', 'Matching story');
    const hiddenTask = task('STORY-2', 'Other story', 'EPIC-2');
    const matchingEpic = epic('EPIC-1', 'Matching epic');
    const hiddenEpic = epic('EPIC-2', 'Other epic', {
        assignee: { displayName: 'Someone Else' },
        initiative: { key: 'INIT-2', summary: 'Unrelated initiative' },
    });
    const collections = {
        consolidatedMissingStories: [{ task: matchingTask }, { task: hiddenTask }],
        blockedTasks: [matchingTask, hiddenTask],
        postponedTasks: [matchingTask, hiddenTask],
        futureRoutedEpics: [matchingEpic, hiddenEpic],
        backlogEpics: [matchingEpic, hiddenEpic],
        missingTeamEpics: [matchingEpic, hiddenEpic],
        missingLabelEpics: [matchingEpic, hiddenEpic],
        needsStoriesEntries: [
            { id: 'required-1', epic: matchingEpic },
            { id: 'required-2', epic: hiddenEpic },
        ],
        needsStoriesEpics: [matchingEpic, hiddenEpic],
        waitingForStoriesEpics: [matchingEpic, hiddenEpic],
        emptyEpicsForAlert: [matchingEpic, hiddenEpic],
        doneStoryEpics: [matchingEpic, hiddenEpic],
    };

    const filtered = filterEngAlertCollections(collections, 'portfolio north', {
        'EPIC-1': matchingEpic,
        'EPIC-2': hiddenEpic,
    });

    assert.deepEqual(filtered.consolidatedMissingStories, [{ task: matchingTask }]);
    assert.deepEqual(filtered.blockedTasks, [matchingTask]);
    assert.deepEqual(filtered.postponedTasks, [matchingTask]);
    assert.deepEqual(filtered.futureRoutedEpics, [matchingEpic]);
    assert.deepEqual(filtered.backlogEpics, [matchingEpic]);
    assert.deepEqual(filtered.missingTeamEpics, [matchingEpic]);
    assert.deepEqual(filtered.missingLabelEpics, [matchingEpic]);
    assert.deepEqual(filtered.needsStoriesEntries, [{ id: 'required-1', epic: matchingEpic }]);
    assert.deepEqual(filtered.needsStoriesEpics, [matchingEpic]);
    assert.deepEqual(filtered.waitingForStoriesEpics, [matchingEpic]);
    assert.deepEqual(filtered.emptyEpicsForAlert, [matchingEpic]);
    assert.deepEqual(filtered.doneStoryEpics, [matchingEpic]);
});

test('active Story and Epic filters narrow every ENG alert collection without a search query', async () => {
    const { filterEngAlertCollections } = await loadModule();
    const productTask = task('PRODUCT-1', 'Shared summary', 'PRODUCT-EPIC');
    const techTask = task('TECH-1', 'Shared summary', 'TECH-EPIC');
    const productEpic = epic('PRODUCT-EPIC', 'Shared epic', { projectClass: 'product' });
    const techEpic = epic('TECH-EPIC', 'Shared epic', { projectClass: 'tech' });
    const collections = {
        consolidatedMissingStories: [{ task: productTask }, { task: techTask }],
        blockedTasks: [productTask, techTask],
        postponedTasks: [productTask, techTask],
        futureRoutedEpics: [productEpic, techEpic],
        backlogEpics: [productEpic, techEpic],
        missingTeamEpics: [productEpic, techEpic],
        missingLabelEpics: [productEpic, techEpic],
        needsStoriesEntries: [
            { id: 'required-product', epic: productEpic },
            { id: 'required-tech', epic: techEpic },
        ],
        needsStoriesEpics: [productEpic, techEpic],
        waitingForStoriesEpics: [productEpic, techEpic],
        emptyEpicsForAlert: [productEpic, techEpic],
        doneStoryEpics: [productEpic, techEpic],
    };

    const filtered = filterEngAlertCollections(collections, '', {}, {
        visibleTaskKeys: new Set(['PRODUCT-1']),
        matchesEpicFilters: item => item.projectClass === 'product',
    });

    assert.deepEqual(filtered.consolidatedMissingStories, [{ task: productTask }]);
    assert.deepEqual(filtered.blockedTasks, [productTask]);
    assert.deepEqual(filtered.postponedTasks, [productTask]);
    for (const key of [
        'futureRoutedEpics',
        'backlogEpics',
        'missingTeamEpics',
        'missingLabelEpics',
        'needsStoriesEpics',
        'waitingForStoriesEpics',
        'emptyEpicsForAlert',
        'doneStoryEpics',
    ]) {
        assert.deepEqual(filtered[key], [productEpic], `${key} should follow the Product-only filter`);
    }
    assert.deepEqual(filtered.needsStoriesEntries, [{ id: 'required-product', epic: productEpic }]);
});

test('blank search preserves all ENG alert collections by reference', async () => {
    const { filterEngAlertCollections } = await loadModule();
    const collections = {
        blockedTasks: [task('STORY-1', 'Story')],
        needsStoriesEntries: [{ id: 'required-1', epic: epic('EPIC-1', 'Epic') }],
    };

    assert.equal(filterEngAlertCollections(collections, '   '), collections);
});
