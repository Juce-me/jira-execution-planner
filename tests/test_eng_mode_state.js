const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

async function loadModule() {
    return import('../frontend/src/eng/engModeState.js');
}

function loadEngModeControl() {
    const entryPoint = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngModeControl.jsx');
    const result = esbuild.buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        external: ['react'],
        loader: { '.jsx': 'jsx', '.js': 'jsx' },
    });
    const mod = new Module(entryPoint, module);
    mod.paths = Module._nodeModulePaths(path.dirname(entryPoint));
    mod._compile(result.outputFiles[0].text, entryPoint);
    return mod.exports.default;
}

// Renders useEngModeState in a probe component and hands back the applyEngMode callback plus
// every setter call it made. Server rendering never runs the mutual-exclusion effects, so this
// isolates what applyEngMode itself writes.
async function renderEngModeState(flags = {}) {
    const { useEngModeState } = await loadModule();
    const setterCalls = { showPlanning: [], showStats: [], showScenario: [], showBoard: [] };
    const selectContentCalls = [];
    let applyEngMode = null;
    let activeEngMode = null;

    function Probe() {
        const state = useEngModeState({
            showPlanning: Boolean(flags.showPlanning), setShowPlanning: (v) => setterCalls.showPlanning.push(v),
            showStats: Boolean(flags.showStats), setShowStats: (v) => setterCalls.showStats.push(v),
            showScenario: Boolean(flags.showScenario), setShowScenario: (v) => setterCalls.showScenario.push(v),
            showBoard: Boolean(flags.showBoard), setShowBoard: (v) => setterCalls.showBoard.push(v),
            trackSelectContent: (...args) => selectContentCalls.push(args),
        });
        applyEngMode = state.applyEngMode;
        activeEngMode = state.activeEngMode;
        return null;
    }

    renderToStaticMarkup(React.createElement(Probe));
    return { applyEngMode, activeEngMode, setterCalls, selectContentCalls };
}

test('deriveActiveEngMode returns catch-up when all three flags are false', async () => {
    const { deriveActiveEngMode } = await loadModule();
    assert.equal(deriveActiveEngMode({ showScenario: false, showStats: false, showPlanning: false }), 'catch-up');
});

test('deriveActiveEngMode returns each mode for its own single flag', async () => {
    const { deriveActiveEngMode } = await loadModule();
    assert.equal(deriveActiveEngMode({ showScenario: true, showStats: false, showPlanning: false }), 'scenario');
    assert.equal(deriveActiveEngMode({ showScenario: false, showStats: true, showPlanning: false }), 'statistics');
    assert.equal(deriveActiveEngMode({ showScenario: false, showStats: false, showPlanning: true }), 'planning');
});

test('deriveActiveEngMode precedence: scenario beats statistics beats planning', async () => {
    const { deriveActiveEngMode } = await loadModule();

    // Every pair, both flags true.
    assert.equal(deriveActiveEngMode({ showScenario: true, showStats: true, showPlanning: false }), 'scenario', 'scenario beats statistics');
    assert.equal(deriveActiveEngMode({ showScenario: true, showStats: false, showPlanning: true }), 'scenario', 'scenario beats planning');
    assert.equal(deriveActiveEngMode({ showScenario: false, showStats: true, showPlanning: true }), 'statistics', 'statistics beats planning');

    // All three true.
    assert.equal(deriveActiveEngMode({ showScenario: true, showStats: true, showPlanning: true }), 'scenario', 'scenario beats everything');
});

test('deriveActiveEngMode treats missing/undefined properties as false', async () => {
    const { deriveActiveEngMode } = await loadModule();
    assert.equal(deriveActiveEngMode({}), 'catch-up');
    assert.equal(deriveActiveEngMode(undefined), 'catch-up');
    assert.equal(deriveActiveEngMode({ showStats: true }), 'statistics');
});

test('deriveActiveEngMode returns board for showBoard alone and still defaults to catch-up', async () => {
    const { deriveActiveEngMode } = await loadModule();
    assert.equal(deriveActiveEngMode({ showScenario: false, showStats: false, showPlanning: false, showBoard: true }), 'board');
    assert.equal(deriveActiveEngMode({ showBoard: true }), 'board');
    assert.equal(deriveActiveEngMode({ showScenario: false, showStats: false, showPlanning: false, showBoard: false }), 'catch-up');
});

test('deriveActiveEngMode precedence: board loses to planning, statistics and scenario', async () => {
    const { deriveActiveEngMode } = await loadModule();
    assert.equal(deriveActiveEngMode({ showBoard: true, showPlanning: true }), 'planning', 'planning beats board');
    assert.equal(deriveActiveEngMode({ showBoard: true, showStats: true }), 'statistics', 'statistics beats board');
    assert.equal(deriveActiveEngMode({ showBoard: true, showScenario: true }), 'scenario', 'scenario beats board');
    assert.equal(deriveActiveEngMode({ showBoard: true, showPlanning: true, showStats: true, showScenario: true }), 'scenario', 'scenario beats everything');
});

test('applyEngMode("board") sets exactly one mode boolean true', async () => {
    const { applyEngMode, setterCalls } = await renderEngModeState();
    applyEngMode('board');
    assert.deepEqual(setterCalls, {
        showPlanning: [false],
        showStats: [false],
        showScenario: [false],
        showBoard: [true],
    });
});

test('applyEngMode clears showBoard when another mode is chosen', async () => {
    for (const mode of ['catch-up', 'planning', 'statistics', 'scenario']) {
        const { applyEngMode, setterCalls } = await renderEngModeState({ showBoard: true });
        applyEngMode(mode);
        assert.deepEqual(setterCalls.showBoard, [false], `${mode} must clear showBoard`);
    }
});

test('applyEngMode reports board as the from_mode of the next switch', async () => {
    const { activeEngMode, applyEngMode, selectContentCalls } = await renderEngModeState({ showBoard: true });
    assert.equal(activeEngMode, 'board');
    applyEngMode('statistics');
    assert.deepEqual(selectContentCalls, [
        ['eng_mode', 'statistics', { from_mode: 'board', dashboard_view: 'eng' }],
    ]);
});

test('EngModeControl offers Board third, between Planning and Statistics, never disabled', () => {
    const EngModeControl = loadEngModeControl();
    const renderControl = (props) => renderToStaticMarkup(React.createElement(EngModeControl, {
        activeMode: 'board',
        isCompletedSprintSelected: false,
        isFutureSprintSelected: false,
        onChange: () => {},
        selectedSprint: 'sprint-1',
        ...props,
    }));

    const markup = renderControl();
    assert.deepEqual(
        Array.from(markup.matchAll(/>([^<>]+)<\/button>/g), ([, label]) => label),
        ['Catch Up', 'Planning', 'Board', 'Statistics', 'Scenario']
    );
    assert.match(markup, /aria-checked="true"[^>]*>Board</, 'Board renders as the checked radio for activeMode="board"');

    // Board is a read view: it has no disabled predicate in any sprint state, including none.
    for (const props of [
        { isCompletedSprintSelected: true },
        { isFutureSprintSelected: true },
        { selectedSprint: '' },
    ]) {
        const boardButton = renderControl(props).match(/<button[^>]*>Board<\/button>/)[0];
        assert.doesNotMatch(boardButton, /disabled/, `Board must stay enabled for ${JSON.stringify(props)}`);
    }
});
