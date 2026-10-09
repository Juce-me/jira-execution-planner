const test = require('node:test');
const assert = require('node:assert/strict');

// §4.4/D41 — an epic has no projectKey of its own, so the board reuses the app's existing
// story-derived some() rule via the caller's isTechTask predicate (injected, never re-derived —
// this module must never import techProjectKeys or touch capacityClassification.mjs). §6.2's
// story-progress bar reuses buildStorySubtaskProgress rather than hand-rolled percentages.

test('classifyEpicProjects: stories all on the Tech side -> Tech only', async () => {
    const { classifyEpicProjects } = await import('../frontend/src/eng/engBoardCardModel.js');
    const isTechTask = (task) => task.fields.projectKey === 'TECH';
    const epicGroup = {
        tasks: [
            { key: 'TECH-1', fields: { projectKey: 'TECH' } },
            { key: 'TECH-2', fields: { projectKey: 'TECH' } },
        ],
    };
    assert.deepEqual(classifyEpicProjects(epicGroup, isTechTask), { isTech: true, isProduct: false, isOther: false });
});

test('classifyEpicProjects: stories all on the Product side -> Product only', async () => {
    const { classifyEpicProjects } = await import('../frontend/src/eng/engBoardCardModel.js');
    const isTechTask = (task) => task.fields.projectKey === 'TECH';
    const epicGroup = {
        tasks: [
            { key: 'PROD-1', fields: { projectKey: 'PROD' } },
            { key: 'PROD-2', fields: { projectKey: 'PROD' } },
        ],
    };
    assert.deepEqual(classifyEpicProjects(epicGroup, isTechTask), { isTech: false, isProduct: true, isOther: false });
});

test('classifyEpicProjects: stories on both sides -> both (D41 — the honest answer, not a defect)', async () => {
    const { classifyEpicProjects } = await import('../frontend/src/eng/engBoardCardModel.js');
    const isTechTask = (task) => task.fields.projectKey === 'TECH';
    const epicGroup = {
        tasks: [
            { key: 'TECH-1', fields: { projectKey: 'TECH' } },
            { key: 'PROD-1', fields: { projectKey: 'PROD' } },
        ],
    };
    assert.deepEqual(classifyEpicProjects(epicGroup, isTechTask), { isTech: true, isProduct: true, isOther: false });
});

test('classifyEpicProjects: an epic with no stories in scope -> neither', async () => {
    const { classifyEpicProjects } = await import('../frontend/src/eng/engBoardCardModel.js');
    const isTechTask = () => { throw new Error('isTechTask must not be called with zero tasks'); };
    assert.deepEqual(classifyEpicProjects({ tasks: [] }, isTechTask), { isTech: false, isProduct: false, isOther: false });
    assert.deepEqual(classifyEpicProjects({}, isTechTask), { isTech: false, isProduct: false, isOther: false });
});

test('classifyEpicProjects preserves strict product, tech, and other classifications', async () => {
    const { classifyEpicProjects } = await import('../frontend/src/eng/engBoardCardModel.js');
    const epicGroup = {
        tasks: [
            { key: 'TECH-1', projectClassification: 'tech' },
            { key: 'PROD-1', projectClassification: 'product' },
            { key: 'OTHER-1', projectClassification: 'other' },
        ],
    };
    const classify = (task) => task.projectClassification;
    assert.deepEqual(classifyEpicProjects(epicGroup, classify), {
        isTech: true,
        isProduct: true,
        isOther: true,
    });
});

test('computeEpicStoryProgress: counts done/in-progress via the shared status phase ranks', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const tasks = [
        { fields: { status: { name: 'Done' } } },
        { fields: { status: { name: 'In Progress' } } },
        { fields: { status: { name: 'To Do' } } },
    ];
    const progress = computeEpicStoryProgress(tasks);
    assert.equal(progress.total, 3);
    assert.equal(progress.done, 1);
    assert.equal(progress.inProgress, 1);
    assert.equal(progress.waiting, 1);
});

// Issue #253 reverses the earlier decision that Killed is abandoned work kept in the total:
// Killed is taken off the total (like the story-subtask bar's EXCLUDED_STATUSES) and Incomplete
// counts as done. Cancelled/Rejected/Won't do stay inside the total as not done.
const progressFor = (names) => names.map((name) => ({ fields: { status: { name } } }));

test('computeEpicStoryProgress: Incomplete counts as done and Killed leaves the total', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStoryProgress(progressFor(['Done', 'Killed', 'Incomplete', 'In Progress', 'To Do']));
    assert.equal(progress.total, 4);
    assert.equal(progress.done, 2);
    assert.equal(progress.inProgress, 1);
    assert.equal(progress.waiting, 1);
    assert.equal(progress.doneWidth, '50%');
    assert.equal(progress.inProgressWidth, '25%');
});

test('computeEpicStoryProgress: Done plus Killed is fully done; only Killed is no stories', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const fullyDone = computeEpicStoryProgress(progressFor(['Done', 'Killed']));
    assert.equal(fullyDone.total, 1);
    assert.equal(fullyDone.done, 1);
    assert.equal(fullyDone.doneWidth, '100%');
    const onlyKilled = computeEpicStoryProgress(progressFor(['Killed', 'Killed']));
    assert.equal(onlyKilled.total, 0);
    assert.equal(onlyKilled.done, 0);
    assert.equal(onlyKilled.hasProgress, false);
    assert.equal(onlyKilled.percentLabel, '0%');
});

test('computeEpicStoryProgress: Cancelled, Rejected and Won\'t do stay inside the total but not done', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStoryProgress(progressFor(['Done', 'Cancelled', 'Canceled', 'Rejected', "Won't do"]));
    assert.equal(progress.total, 5);
    assert.equal(progress.done, 1);
    assert.equal(progress.inProgress, 0);
    assert.equal(progress.waiting, 4);
});

test('computeEpicStoryProgress: status matching ignores case and surrounding whitespace', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStoryProgress(progressFor([' KILLED ', 'incomplete', ' Incomplete ']));
    assert.equal(progress.total, 2);
    assert.equal(progress.done, 2);
});

test('computeEpicStatusCountProgress: server status counts apply the same rules', async () => {
    const { computeEpicStatusCountProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStatusCountProgress(
        { Done: 2, Killed: 1, Incomplete: 1, 'In Progress': 1, Cancelled: 1, 'To Do': 2 }, 8,
    );
    assert.equal(progress.total, 7);
    assert.equal(progress.done, 3);
    assert.equal(progress.inProgress, 1);
    assert.equal(progress.waiting, 3);
});

test('drop gate: Killed and Incomplete children are no longer open stories', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const { openStoryCount, needsOpenStoryConfirmation } = await import('../frontend/src/eng/engBoardDrop.js');
    const resolved = computeEpicStoryProgress(progressFor(['Done', 'Killed', 'Incomplete']));
    assert.equal(openStoryCount(resolved), 0);
    assert.equal(needsOpenStoryConfirmation({ status: 'Done', progress: resolved }), false);
    const withOpen = computeEpicStoryProgress(progressFor(['Done', 'Killed', 'To Do']));
    assert.equal(openStoryCount(withOpen), 1);
    assert.equal(needsOpenStoryConfirmation({ status: 'Done', progress: withOpen }), true);
});

test('computeEpicStoryProgress: no stories -> zeroed, no throw', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStoryProgress([]);
    assert.equal(progress.total, 0);
    assert.equal(progress.done, 0);
    assert.equal(progress.inProgress, 0);
    assert.equal(progress.percentLabel, '0%');
});

test('computeEpicStoryProgress: a story with no status name does not throw', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    assert.doesNotThrow(() => computeEpicStoryProgress([{ fields: {} }, {}]));
});
