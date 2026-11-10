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

// The project half of useEngAlertFilters' matchesEpicFilters, as the pure `admitsAlertEpicProject`.
test('DELIVERY Initiative alerts follow the Initiative class; Tech-only keeps Tech alerts', async () => {
    const { admitsAlertEpicProject } = await loadModule();
    const { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } = await import('../frontend/src/eng/engCatchUpFilters.js');
    const deliveryModel = buildEngCatchUpFacetModel({ tasks: [], workModel: 'rnd_2027' });
    const techKeys = new Set(['TECH']);
    const initiatives = [
        epic('PLAN-1', 'Tech Initiative', { projectClass: 'tech' }),
        epic('PLAN-2', 'Product Initiative', { projectClass: 'product' }),
        epic('PLAN-3', 'No Allocation Initiative', { projectClass: 'none' }),
        // The Initiative's class decides even when its Jira project is a Tech project.
        epic('TECH-4', 'Product Initiative in a Tech project', { projectClass: 'product' }),
        epic('PLAN-5', 'Unreadable Initiative'),
    ];
    const admitted = (filters) => initiatives.filter((item) => admitsAlertEpicProject(item, filters, techKeys)).map((item) => item.key);
    assert.deepEqual(admitted(resolveEngCatchUpFilters({ model: deliveryModel })), ['PLAN-1', 'PLAN-2', 'PLAN-3', 'TECH-4', 'PLAN-5']);
    assert.deepEqual(admitted(resolveEngCatchUpFilters({ model: deliveryModel, allocation: ['tech'] })), ['PLAN-1']);
    assert.deepEqual(admitted(resolveEngCatchUpFilters({ model: deliveryModel, allocation: ['product'] })), ['PLAN-2', 'TECH-4']);
    assert.deepEqual(admitted(resolveEngCatchUpFilters({ model: deliveryModel, allocation: [] })), ['PLAN-3', 'PLAN-5']);

    // Legacy: Tech-only keeps the Tech alerts, by class or by Tech project key.
    const legacyModel = buildEngCatchUpFacetModel({ tasks: [{ key: 'TECH-9', fields: { projectKey: 'TECH' } }, { key: 'PROD-9', fields: { projectKey: 'PROD' } }],
        isTechTask: (item) => item.fields.projectKey === 'TECH' });
    const legacyEpics = [epic('TECH-1', 'Tech by key'), epic('PROD-2', 'Tech by class', { projectClass: 'tech' }), epic('PROD-3', 'Product')];
    const legacyTechOnly = resolveEngCatchUpFilters({ model: legacyModel, showProduct: false });
    assert.deepEqual(legacyEpics.filter((item) => admitsAlertEpicProject(item, legacyTechOnly, techKeys)).map((item) => item.key), ['TECH-1', 'PROD-2']);
});

// Production shape: empty, future-routed and ready-to-close Initiative alerts come from epicsInScope and carry neither
// projectClass nor allocationClass; their class is the Initiative record's `allocationClass` in epicDetails.
test('DELIVERY alerts without a class read the Initiative class from epicDetails', async () => {
    const { admitsAlertEpicProject, filterEngAlertCollections } = await loadModule();
    const { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } = await import('../frontend/src/eng/engCatchUpFilters.js');
    const epicDetails = {
        'PLAN-10': { key: 'PLAN-10', allocationClass: 'product' },
        'PLAN-11': { key: 'PLAN-11', allocationClass: 'tech' },
        'PLAN-12': { key: 'PLAN-12', allocationClass: 'none' },
    };
    const model = buildEngCatchUpFacetModel({ tasks: [], epicDetails, workModel: 'rnd_2027' });
    const alertEpics = ['PLAN-10', 'PLAN-11', 'PLAN-12', 'PLAN-13'].map((key) => ({ key, summary: key, status: { name: 'To Do' } }));
    const admitted = (allocation) => alertEpics
        .filter((item) => admitsAlertEpicProject(item, resolveEngCatchUpFilters({ model, allocation }), new Set()))
        .map((item) => item.key);
    assert.deepEqual(admitted(['product']), ['PLAN-10']);
    assert.deepEqual(admitted(['tech']), ['PLAN-11']);
    // Not in epicDetails (its Initiative not loaded): No Allocation.
    assert.deepEqual(admitted([]), ['PLAN-12', 'PLAN-13']);
    assert.deepEqual(admitted(undefined), ['PLAN-10', 'PLAN-11', 'PLAN-12', 'PLAN-13']);
    const filters = resolveEngCatchUpFilters({ model, allocation: ['tech'] });
    const filtered = filterEngAlertCollections({ emptyEpicsForAlert: alertEpics, futureRoutedEpics: alertEpics, doneStoryEpics: alertEpics }, '', epicDetails, {
        matchesEpicFilters: (item) => admitsAlertEpicProject(item, filters, new Set()),
    });
    for (const key of ['emptyEpicsForAlert', 'futureRoutedEpics', 'doneStoryEpics']) assert.deepEqual(filtered[key].map((item) => item.key), ['PLAN-11'], key);
});
