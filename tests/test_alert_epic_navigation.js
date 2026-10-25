import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildStoryRequirementDismissalId,
    buildStoryRequirementId,
    navigateToStoryRequirement,
    storyRequirementScrollTop,
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

const landing = {
    scrollY: 1000,
    stackBottom: 108,
    viewportHeight: 800,
    maxScroll: 5000,
    epicTop: 400,
    epicHeight: 300,
    cardTop: 600,
    cardHeight: 80,
};

test('an Epic that fits below the stack lands its top 12px under the stack', () => {
    assert.equal(storyRequirementScrollTop(landing), 1000 + 400 - (108 + 12));
});

test('an Epic taller than the space below the stack centres the requirement card as before', () => {
    const tall = { ...landing, epicTop: -900, epicHeight: 2600 };
    const available = 800 - (108 + 12);
    assert.equal(storyRequirementScrollTop(tall), 1000 + 600 - (108 + 12) - (available - 80) / 2);
});

test('an Epic exactly as tall as the space below the stack still lands its top under the stack', () => {
    assert.equal(storyRequirementScrollTop({ ...landing, epicHeight: 800 - 120 }), 1000 + 400 - 120);
});

test('a card taller than the space below the stack puts its top under the stack', () => {
    const tall = { ...landing, epicHeight: 3000, cardHeight: 900 };
    assert.equal(storyRequirementScrollTop(tall), 1000 + 600 - 120);
});

test('the landing is clamped to the document end and never negative', () => {
    assert.equal(storyRequirementScrollTop({ ...landing, maxScroll: 1100 }), 1100);
    assert.equal(storyRequirementScrollTop({ ...landing, scrollY: 0, epicTop: 50 }), 0);
    assert.equal(storyRequirementScrollTop({ ...landing, maxScroll: -20 }), 0);
});

test('a card outside an Epic block keeps the centred landing', () => {
    const available = 800 - 120;
    assert.equal(
        storyRequirementScrollTop({ ...landing, epicTop: undefined, epicHeight: undefined }),
        1000 + 600 - 120 - (available - 80) / 2,
    );
});

function installFakeDom({ requirementId }) {
    const timers = new Map();
    let nextTimer = 1;
    const frames = [];
    const scrolls = [];
    const listeners = new Map();
    const classes = new Set();
    const focusCalls = [];
    const card = {
        isConnected: true,
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
        },
        get offsetWidth() { return 100; },
        getAttribute: name => (name === 'data-story-requirement-id' ? requirementId : null),
        getBoundingClientRect: () => ({ top: 600, bottom: 680, height: 80 }),
        closest: selector => (selector === '.epic-block' ? { getBoundingClientRect: () => ({ top: 400, bottom: 700, height: 300 }) } : null),
        focus: options => focusCalls.push(options),
    };
    globalThis.document = {
        documentElement: { scrollHeight: 6000 },
        querySelectorAll: selector => (selector === '[data-story-requirement-id]' ? [card] : []),
    };
    globalThis.window = {
        scrollY: 1000,
        innerHeight: 800,
        scrollTo: options => scrolls.push(options),
        getComputedStyle: () => ({ position: 'static', top: 'auto' }),
        requestAnimationFrame: callback => frames.push(callback),
        addEventListener: (name, handler) => listeners.set(name, handler),
        removeEventListener: name => listeners.delete(name),
        setTimeout: (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, ms }); return id; },
        clearTimeout: id => timers.delete(id),
    };
    return { card, classes, focusCalls, frames, scrolls, timers, listeners };
}

test('revealing a requirement scrolls to its Epic, highlights it, focuses without scrolling and replaces the earlier timer', () => {
    const dom = installFakeDom({ requirementId: 'req-1' });
    try {
        const reveal = () => navigateToStoryRequirement({ requirementId: 'req-1', prefersReducedMotion: () => false });
        assert.equal(reveal(), true);
        assert.deepEqual(dom.scrolls, [{ top: 1000 + 400 - 12, behavior: 'smooth' }]);
        assert.equal(dom.classes.has('story-requirement-highlight'), true);
        assert.deepEqual(dom.focusCalls, [{ preventScroll: true }]);
        assert.deepEqual([...dom.timers.values()].map(timer => timer.ms), [2200]);

        assert.equal(reveal(), true);
        assert.equal(dom.timers.size, 1, 'the second reveal replaces the first highlight timer');
        [...dom.timers.values()][0].callback();
        assert.equal(dom.classes.has('story-requirement-highlight'), false);
    } finally {
        delete globalThis.window;
        delete globalThis.document;
    }
});

test('the reveal re-aims while the sticky stack grows and stops once the page rests on the target', () => {
    const dom = installFakeDom({ requirementId: 'req-1' });
    try {
        navigateToStoryRequirement({ requirementId: 'req-1', prefersReducedMotion: () => true });
        assert.deepEqual(dom.scrolls, [{ top: 1388, behavior: 'auto' }]);
        // The page reached the first aim; the filter bar pinned on the way and now ends the stack at 108px.
        window.scrollY = 1388;
        dom.card.getBoundingClientRect = () => ({ top: 212, bottom: 292, height: 80 });
        dom.card.closest = () => ({ getBoundingClientRect: () => ({ top: 12, bottom: 312, height: 300 }) });
        const filterBar = { getBoundingClientRect: () => ({ top: 0, bottom: 108 }) };
        document.querySelectorAll = selector => {
            if (selector === '[data-story-requirement-id]') return [dom.card];
            return selector === '.filterbar-wrap' ? [filterBar] : [];
        };
        window.getComputedStyle = element => (element === filterBar ? { position: 'sticky', top: '0px' } : { position: 'static', top: 'auto' });
        dom.frames.shift()();
        assert.deepEqual(dom.scrolls.at(-1), { top: 1388 + 12 - 120, behavior: 'auto' });
        window.scrollY = 1280;
        dom.card.closest = () => ({ getBoundingClientRect: () => ({ top: 120, bottom: 420, height: 300 }) });
        while (dom.frames.length) dom.frames.shift()();
        assert.equal(dom.scrolls.length, 2);
        assert.equal(dom.listeners.size, 0, 'the settled reveal stops listening for user input');
    } finally {
        delete globalThis.window;
        delete globalThis.document;
    }
});

test('user input ends the reveal before it re-aims', () => {
    const dom = installFakeDom({ requirementId: 'req-1' });
    try {
        navigateToStoryRequirement({ requirementId: 'req-1', prefersReducedMotion: () => true });
        dom.listeners.get('wheel')();
        dom.card.closest = () => ({ getBoundingClientRect: () => ({ top: 900, bottom: 1200, height: 300 }) });
        while (dom.frames.length) dom.frames.shift()();
        assert.equal(dom.scrolls.length, 1);
        assert.equal(dom.listeners.size, 0);
    } finally {
        delete globalThis.window;
        delete globalThis.document;
    }
});
