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
// 2. §13 fences off useEngStatusTransitions.js and permits exactly ONE generalization: widen the
//    `isCatchUp` optimistic-patch gate to `sourceSurface !== 'planning'` and rename it
//    `isSingleIssueSurface`. A board special case in this file remains a review stop.

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
    assert.match(source, /const isSingleIssueSurface = sourceSurface !== 'planning';/);
    assert.ok(!/isCatchUp/.test(source), 'the rename ships with the widening — no isCatchUp may remain');
});

test('the hook gates every branch the old flag gated, and no more', () => {
    const source = read('frontend/src/eng/useEngStatusTransitions.js');
    // isCatchUp appeared 13 times before the rename (one definition, twelve reads). The new flag
    // must appear exactly as often: a branch gained or lost is a behaviour change, not a rename.
    assert.equal((source.match(/isSingleIssueSurface/g) || []).length, 13);
});

test('the hook carries no board special case', () => {
    const source = read('frontend/src/eng/useEngStatusTransitions.js');
    assert.ok(!source.includes("'board'"), 'a board branch inside the shared hook is a review stop (§9.5)');
});

test('the widened flag is a strict widening: Catch Up keeps the same branches', () => {
    // The behavioural claim the §13 amendment is conditioned on, stated over every surface the
    // hook is instantiated with (dashboard.jsx: showPlanning ? 'planning' : showBoard ? 'board'
    // : 'catch_up'). Catch Up and Planning both evaluate exactly as they did; only Board moves.
    const wasCatchUpOnly = (surface) => surface === 'catch_up';
    const isSingleIssueSurface = (surface) => surface !== 'planning';

    assert.equal(isSingleIssueSurface('catch_up'), wasCatchUpOnly('catch_up'));
    assert.equal(isSingleIssueSurface('planning'), wasCatchUpOnly('planning'));
    assert.equal(isSingleIssueSurface('board'), true);
    assert.equal(wasCatchUpOnly('board'), false);
});
