const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Two guards the drag feature cannot be reviewed without (§9.5, §13).
//
// 1. The board acts on ONE explicit issue. Without a key, useEngStatusTransitions falls through to
//    the `buildEngStatusTargets({ selectedTasksList: selectedStories })` arm — the PLANNING
//    selection — which on the board is either a silent no-op or a write to Jira issues the user
//    never dragged. Drag is the first call site whose "issue" comes from a card rather than a menu
//    argument, so the fallthrough is fenced off at the call site, not hoped away.
//
// 2. The single-issue path remains serialized. Board may additionally request one strict-owner
//    refresh after success; it must not introduce another Jira write path.

function read(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('a board status submit without an issue key is refused before it reaches the hook', () => {
    const source = read('frontend/src/dashboard.jsx');
    assert.match(
        source,
        /if \(statusTransitionSourceSurface === 'board' && !issue\?\.key\) return null;/,
        'handleSubmitStatusTransition must refuse a keyless board submit rather than fall through to the Planning selection',
    );
});

test('the hook ships the one permitted generalization: the rename with the widening', () => {
    const source = read('frontend/src/eng/useEngStatusTransitions.js');
    assert.match(source, /const isSingleIssueSurface = sourceSurface !== 'planning' \|\| Boolean\(explicitKey\);/);
    assert.ok(!/isCatchUp/.test(source), 'the rename ships with the widening — no isCatchUp may remain');
});

test('the hook keeps single-issue presentation branches while the shared queue owns all writes', () => {
    const source = read('frontend/src/eng/useEngStatusTransitions.js');
    // Task 3 removes the queue-bypass branch, so the flag now owns presentation/reconciliation
    // only; both single and batch writes use enqueueEngIssueMutations.
    assert.equal((source.match(/isSingleIssueSurface/g) || []).length, 12);
    assert.match(source, /await enqueueEngIssueMutations\(/);
});

test('the Board special case refreshes after the shared serialized write', () => {
    const source = read('frontend/src/eng/useEngStatusTransitions.js');
    assert.match(source, /mutationCoordinator\?\.enqueue \|\| enqueueEngIssueMutation/);
    assert.match(source, /await onTransitionSuccessRefresh\?\./);
    assert.match(source, /mutationCoordinator\?\.complete\(\)/);
    assert.equal((source.match(/transitionIssues\(/g) || []).length, 1, 'Board must not add a parallel Jira write');
});

test('the widened flag is a strict widening: only a keyed Planning submit joins the single-issue branches', () => {
    // Catch Up and Board evaluate exactly as they did; keyless Planning stays the Story batch;
    // a Planning submit with an explicit key (Epic, Subtask and Table row pills) acts on that
    // one issue and therefore takes the optimistic patch, rollback and per-key pending guard.
    const wasSingleIssue = (surface) => surface !== 'planning';
    const isSingleIssueSurface = (surface, explicitKey) => surface !== 'planning' || Boolean(explicitKey);

    for (const surface of ['catch_up', 'board']) {
        assert.equal(isSingleIssueSurface(surface, ''), wasSingleIssue(surface));
        assert.equal(isSingleIssueSurface(surface, 'KEY-1'), true);
    }
    assert.equal(isSingleIssueSurface('planning', ''), false);
    assert.equal(isSingleIssueSurface('planning', 'KEY-1'), true);
});

test('Planning Table status pills submit through the keyed handler, never the raw hook', () => {
    const source = read('frontend/src/dashboard.jsx');
    assert.match(
        source,
        /sourceSurface="planning" isOpen=\{statusTransitionActiveKey === row\.key\}[\s\S]*?actsOnSelection=\{false\}[\s\S]*?onSubmit=\{\(targetStatus\) => handleSubmitStatusTransition\(targetStatus, \{ key: row\.key \}, \{ singleIssue: true \}\)\}/,
        'a Table row pill must act on its own row, not on the selected Stories',
    );
});
