const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

const ENTRY = path.join(__dirname, '..', 'frontend', 'src', 'onboarding', 'useOnboardingTour.js');

function mountController(props) {
    return mountBundledHook({
        entry: ENTRY, exportName: 'useOnboardingController', modules: {},
        makeProps: () => ({ bootstrapReady: true, activeSurface: 'catch-up', completedModules: [], trackSettingsAction: () => {}, ...props }),
    });
}

function withWindow(fn) {
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    try { return fn(); } finally { delete globalThis.window; }
}

test('the Catch Up tour does not auto-start while a shareable link is still applying, and starts once it settles', () => withWindow(() => {
    const hook = mountController({ applyTerminal: false });
    hook.render();
    assert.equal(hook.render().run, false);
    assert.equal(hook.render({ applyTerminal: true }).run, false, 'the start is requested by the effect and shown on the next render');
    assert.equal(hook.render({ applyTerminal: true }).run, true);
    hook.unmount();
}));

test('without a link the tour starts as before', () => withWindow(() => {
    const hook = mountController({});
    hook.render();
    assert.equal(hook.render().run, true);
    hook.unmount();
}));

test('a link that settles after the user already completed Catch Up does not start the tour', () => withWindow(() => {
    const hook = mountController({ applyTerminal: false, completedModules: ['catch-up'] });
    hook.render();
    hook.render({ applyTerminal: true });
    assert.equal(hook.render({ applyTerminal: true }).run, false);
    hook.unmount();
}));
