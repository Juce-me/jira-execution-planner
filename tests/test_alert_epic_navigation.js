import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildStoryRequirementDismissalId,
    buildStoryRequirementId,
    navigateToStoryRequirement,
} from '../frontend/src/eng/alertEpicNavigation.js';

test('story requirement identity is composite and safe for DOM attributes', () => {
    const identity = { groupId: 'dept/a', sprintId: '42', epicKey: 'PROJ-7', teamId: 'team::orbit' };
    assert.equal(buildStoryRequirementId(identity), 'story-required::dept%2Fa::42::PROJ-7::team%3A%3Aorbit');
    assert.equal(
        buildStoryRequirementDismissalId(identity),
        'story-required::dept%2Fa::42::PROJ-7::team%3A%3Aorbit',
    );
});

test('requirement navigation clears only through its supplied hiding-filter callback and retries', () => {
    const calls = [];
    let attempts = 0;
    const result = navigateToStoryRequirement({
        requirementId: 'dept::42::PROJ-7::orbit',
        clearHidingFilters: () => calls.push('clear'),
        onMissing: () => calls.push('missing'),
        prefersReducedMotion: () => true,
        reveal: (id, options) => {
            calls.push(['reveal', id, options]);
            attempts += 1;
            return attempts === 2;
        },
        schedule: callback => callback(),
    });

    assert.equal(result, false);
    assert.deepEqual(calls, [
        ['reveal', 'dept::42::PROJ-7::orbit', { reducedMotion: true }],
        'clear',
        ['reveal', 'dept::42::PROJ-7::orbit', { reducedMotion: true }],
    ]);
});

test('requirement navigation reports a bounded local miss without external fallback', () => {
    const calls = [];
    navigateToStoryRequirement({
        requirementId: 'missing',
        clearHidingFilters: () => calls.push('clear'),
        onMissing: id => calls.push(['missing', id]),
        prefersReducedMotion: () => false,
        reveal: () => false,
        schedule: callback => callback(),
    });
    assert.deepEqual(calls, ['clear', ['missing', 'missing']]);
});
