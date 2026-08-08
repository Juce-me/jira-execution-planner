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
    assert.deepEqual(classifyEpicProjects(epicGroup, isTechTask), { isTech: true, isProduct: false });
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
    assert.deepEqual(classifyEpicProjects(epicGroup, isTechTask), { isTech: false, isProduct: true });
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
    assert.deepEqual(classifyEpicProjects(epicGroup, isTechTask), { isTech: true, isProduct: true });
});

test('classifyEpicProjects: an epic with no stories in scope -> neither', async () => {
    const { classifyEpicProjects } = await import('../frontend/src/eng/engBoardCardModel.js');
    const isTechTask = () => { throw new Error('isTechTask must not be called with zero tasks'); };
    assert.deepEqual(classifyEpicProjects({ tasks: [] }, isTechTask), { isTech: false, isProduct: false });
    assert.deepEqual(classifyEpicProjects({}, isTechTask), { isTech: false, isProduct: false });
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

// Deliberate decision (not the DEFAULT_STATUS_PHASE_RANKS default): a killed story is abandoned,
// not delivered, so it must not fill the "done" segment of a percent-complete bar. This mirrors
// the app's own analogous story-subtask progress bar (backend/services/eng_subtasks.py:
// DONE_STATUSES = {"done"}, EXCLUDED_STATUSES = {"killed"}), which already draws this line.
// Cancelled/rejected/won't-do are the same kind of abandonment as Killed (DEFAULT_STATUS_PHASE_RANKS
// groups all four in its "done" phase for SORT order) and are treated the same way here, so a
// future status among the four cannot silently count as done while Killed does not.
test('computeEpicStoryProgress: Killed does not count as done — it is abandoned, not delivered', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const tasks = [
        { fields: { status: { name: 'Done' } } },
        { fields: { status: { name: 'Killed' } } },
        { fields: { status: { name: 'Cancelled' } } },
        { fields: { status: { name: 'In Progress' } } },
    ];
    const progress = computeEpicStoryProgress(tasks);
    // Killed and its siblings stay IN the total (an epic's "n of m stories" counts every story)
    // but land in `waiting`, buildStorySubtaskProgress's residual bucket — not `done`.
    assert.equal(progress.total, 4);
    assert.equal(progress.done, 1);
    assert.equal(progress.inProgress, 1);
    assert.equal(progress.waiting, 2);
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
