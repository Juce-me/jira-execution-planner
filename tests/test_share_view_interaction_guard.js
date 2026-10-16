const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const MODULE_PATH = path.join(__dirname, '..', 'frontend', 'src', 'shareView', 'interactionGuard.js');

function loadModule() {
    const source = esbuild.buildSync({
        entryPoints: [MODULE_PATH], bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', source)(module, module.exports);
    return module.exports;
}

const { armInteractionGuard, SHARE_VIEW_MODIFIER_KEYS } = loadModule();

function fakeDocument() {
    const listeners = [];
    return {
        listeners,
        addEventListener: (type, handler, options) => listeners.push({ type, handler, options }),
        removeEventListener: (type, handler, options) => {
            const index = listeners.findIndex(entry => entry.type === type && entry.handler === handler && entry.options.capture === options.capture);
            if (index >= 0) listeners.splice(index, 1);
        },
        dispatch(event) { listeners.filter(entry => entry.type === event.type).forEach(entry => entry.handler(event)); },
    };
}

test('the guard listens on the document in the capture phase for the five interaction events and removes them again', () => {
    const doc = fakeDocument();
    const disarm = armInteractionGuard({ doc, onInteraction: () => {} });
    assert.deepEqual(doc.listeners.map(entry => entry.type).sort(), ['keydown', 'pointerdown', 'touchmove', 'touchstart', 'wheel']);
    assert.ok(doc.listeners.every(entry => entry.options.capture === true && entry.options.passive === true));
    disarm();
    assert.deepEqual(doc.listeners, []);
});

test('pointer, touch and non-modifier key presses are deliberate and scrolling is only a scroll', () => {
    const doc = fakeDocument();
    const seen = [];
    armInteractionGuard({ doc, onInteraction: kind => seen.push(kind) });
    doc.dispatch({ type: 'pointerdown' });
    doc.dispatch({ type: 'touchstart' });
    doc.dispatch({ type: 'keydown', key: 'a' });
    doc.dispatch({ type: 'keydown', key: 'Escape' });
    doc.dispatch({ type: 'wheel' });
    doc.dispatch({ type: 'touchmove' });
    assert.deepEqual(seen, ['deliberate', 'deliberate', 'deliberate', 'deliberate', 'scroll', 'scroll']);
});

test('the modifier and lock keys are one pinned list of eleven', () => {
    assert.deepEqual([...SHARE_VIEW_MODIFIER_KEYS], ['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS']);
});

test('modifier keys, untrusted events and a paused link are ignored', () => {
    const doc = fakeDocument();
    const seen = [];
    let paused = false;
    armInteractionGuard({ doc, onInteraction: kind => seen.push(kind), isPaused: () => paused });
    for (const key of SHARE_VIEW_MODIFIER_KEYS) doc.dispatch({ type: 'keydown', key });
    doc.dispatch({ type: 'pointerdown', isTrusted: false });
    paused = true;
    doc.dispatch({ type: 'pointerdown' });
    doc.dispatch({ type: 'wheel' });
    assert.deepEqual(seen, []);
    paused = false;
    doc.dispatch({ type: 'pointerdown', isTrusted: true });
    assert.deepEqual(seen, ['deliberate']);
});

test('the terminal auth latch is read first, so a locked app never reacts', () => {
    const doc = fakeDocument();
    const seen = [];
    armInteractionGuard({ doc, onInteraction: kind => seen.push(kind) });
    globalThis.window = { __JEP_AUTH_REQUIRED__: { locked: true } };
    try {
        doc.dispatch({ type: 'pointerdown' });
        doc.dispatch({ type: 'keydown', key: 'a' });
        assert.deepEqual(seen, []);
    } finally {
        delete globalThis.window;
    }
    doc.dispatch({ type: 'pointerdown' });
    assert.deepEqual(seen, ['deliberate']);
});
