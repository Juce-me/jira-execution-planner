const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Two guards the drag feature cannot be reviewed without (§9.5, §13).
//
// 1. Every status submit acts on ONE explicit issue. Without a key nothing is written: the hook no
//    longer has a Planning-selection arm to fall through to, so a dragged card (the first call
//    site whose "issue" comes from a card rather than a menu argument) can never widen to issues
//    the user did not touch. The refusal is fenced off at the call site and again in the hook.
//
// 2. The single-issue path remains serialized. Board may additionally request one strict-owner
//    refresh after success; it must not introduce another Jira write path.

function read(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('a status submit without an issue key is refused before it reaches the hook', () => {
    const source = read('frontend/src/dashboard.jsx');
    assert.match(
        source,
        /if \(!issue\?\.key\) return null;\s*if \(statusTransitionSourceSurface !== 'board'\) return submitStatusTransition\(targetStatus, issue\.key\);/,
        'handleSubmitStatusTransition must refuse a keyless submit on every surface',
    );
});

test('the hook has no Planning-selection arm: a keyless submit writes nothing', () => {
    const source = read('frontend/src/eng/useEngStatusTransitions.js');
    assert.match(source, /if \(!explicitKey\) return null;/);
    assert.ok(!/buildEngStatusTargets/.test(source), 'the selected-Stories batch must not return');
    assert.ok(!/isSingleIssueSurface/.test(source), 'every surface is single-issue; no flag remains');
    assert.ok(!/isCatchUp/.test(source));
});

test('the hook sends every write through the shared queue', () => {
    const source = read('frontend/src/eng/useEngStatusTransitions.js');
    assert.match(source, /await enqueueEngIssueMutations\(/);
});

test('the Board special case refreshes after the shared serialized write', () => {
    const source = read('frontend/src/eng/useEngStatusTransitions.js');
    assert.match(source, /mutationCoordinator\?\.enqueue \|\| enqueueEngIssueMutation/);
    assert.match(source, /await onTransitionSuccessRefresh\?\./);
    assert.match(source, /mutationCoordinator\?\.complete\(\)/);
    assert.equal((source.match(/transitionIssues\(/g) || []).length, 1, 'Board must not add a parallel Jira write');
});

test('Planning Table status pills submit through the keyed handler, never the raw hook', () => {
    const source = read('frontend/src/dashboard.jsx');
    assert.match(
        source,
        /sourceSurface="planning" isOpen=\{statusTransitionActiveKey === row\.key\}[\s\S]*?onSubmit=\{\(targetStatus\) => handleSubmitStatusTransition\(targetStatus, \{ key: row\.key \}\)\}/,
        'a Table row pill must act on its own row, not on the selected Stories',
    );
});
