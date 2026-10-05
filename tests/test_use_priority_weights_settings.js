const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Server-render probe for usePriorityWeightsSettings (ST1 R4a): the hook's defaults and its flat
// return contract. State transitions are covered by the Playwright Settings specs and the
// save-order characterization in tests/ui/settings_unified_save.spec.js.
const hookPath = path.join(__dirname, '../frontend/src/settings/usePriorityWeightsSettings.js');

const EXPECTED_RETURN_NAMES = [
    'priorityWeightsDraft', 'setPriorityWeightsDraft', 'priorityWeightsSource', 'effectivePriorityWeightsRows',
    'isPriorityWeightsDirty', 'priorityWeightsValidationError', 'priorityWeightsSum',
    'loadPriorityWeightsConfig', 'savePriorityWeightsConfig', 'updatePriorityWeightDraft',
    'resetPriorityWeightsDraft', 'applyLoaded', 'draftSnapshot',
];

function loadHook() {
    const code = esbuild.buildSync({
        entryPoints: [hookPath],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
        external: ['react'],
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}

function renderHook(overrides = {}) {
    const { usePriorityWeightsSettings } = loadHook();
    let result;
    const inputs = {
        BACKEND_URL: 'http://example.test',
        acceptSettingsConfigBaseline: () => {},
        clearServerConnectionError: () => {},
        commitSharedConfigRevision: () => {},
        reportServerConnectionError: () => false,
        settingsConfigBaselineRevision: 0,
        settingsDraftSnapshotRef: { current: {} },
        sharedConfigRevisionRef: { current: 0 },
        ...overrides,
    };
    function Probe() {
        result = usePriorityWeightsSettings(inputs);
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return result;
}

test('the hook returns the 13 documented names in order', () => {
    assert.deepEqual(Object.keys(renderHook()), EXPECTED_RETURN_NAMES);
});

test('a fresh hook holds the default weights, is clean and valid', async () => {
    const { DEFAULT_PRIORITY_WEIGHT_ROWS, clonePriorityWeightRows } = await import('../frontend/src/stats/priorityWeights.js');
    const defaults = clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS);
    const result = renderHook();
    assert.deepEqual(result.priorityWeightsDraft, defaults);
    assert.deepEqual(result.effectivePriorityWeightsRows, defaults);
    assert.equal(result.priorityWeightsSource, 'default');
    assert.equal(result.isPriorityWeightsDirty, false);
    assert.equal(result.priorityWeightsValidationError, '');
    assert.equal(result.priorityWeightsSum, defaults.reduce((sum, row) => sum + Number(row.weight), 0));
    assert.equal(result.draftSnapshot, JSON.stringify(defaults));
});

test('every function in the result is callable', () => {
    const result = renderHook();
    for (const name of EXPECTED_RETURN_NAMES.filter((key) => /^(set|load|save|update|reset|apply)/.test(key))) {
        assert.equal(typeof result[name], 'function', name);
    }
});
