const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Server-render probe for useCapacityMappingSettings (ST1 R4c): defaults and the flat return contract of the
// state layer, plus the effects layer rendering without error (effects do not run in a server render).
const hookPath = path.join(__dirname, '../frontend/src/settings/useCapacityMappingSettings.js');

const EXPECTED_RETURN_NAMES = [
    'capacityProjectDraft',
    'setCapacityProjectDraft',
    'capacityFieldIdDraft',
    'setCapacityFieldIdDraft',
    'capacityFieldNameDraft',
    'setCapacityFieldNameDraft',
    'capacityProjectSearchQuery',
    'setCapacityProjectSearchQuery',
    'capacityProjectSearchOpen',
    'setCapacityProjectSearchOpen',
    'capacityProjectSearchIndex',
    'setCapacityProjectSearchIndex',
    'capacityProjectSearchInputRef',
    'capacityFieldSearchQuery',
    'setCapacityFieldSearchQuery',
    'capacityFieldSearchOpen',
    'setCapacityFieldSearchOpen',
    'capacityFieldSearchIndex',
    'setCapacityFieldSearchIndex',
    'capacityFieldSearchInputRef',
    'isCapacityDraftDirty',
    'loadCapacityConfig',
    'saveCapacityConfig',
    'resolveCapacityProjectName',
    'capacityProjectSearchResults',
    'handleCapacityProjectSearchKeyDown',
    'capacityFieldSearchResults',
    'capacityFieldSearchHidden',
    'handleCapacityFieldSearchKeyDown',
    'applyLoaded',
    'draftSnapshot'
];

function loadHooks() {
    const code = esbuild.buildSync({
        entryPoints: [hookPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}

function renderHook(overrides = {}) {
    const { useCapacityMappingSettings, useCapacityMappingEffects } = loadHooks();
    let result;
    const noop = () => {};
    function Probe() {
        result = useCapacityMappingSettings({
            BACKEND_URL: 'http://example.test',
            acceptSettingsConfigBaseline: noop,
            authMode: 'basic',
            commitSharedConfigRevision: noop,
            jiraFields: [{ id: 'customfield_1', name: 'Capacity' }],
            jiraProjects: [{ key: 'AAA', name: 'Alpha' }],
            settingsConfigBaselineRevision: 0,
            settingsDraftSnapshotRef: { current: {} },
            sharedConfigRevisionRef: { current: 0 },
            ...overrides,
        });
        useCapacityMappingEffects({
            capacityFieldSearchIndex: result.capacityFieldSearchIndex,
            capacityFieldSearchResults: result.capacityFieldSearchResults,
            capacityProjectSearchIndex: result.capacityProjectSearchIndex,
            capacityProjectSearchResults: result.capacityProjectSearchResults,
            setCapacityFieldSearchIndex: result.setCapacityFieldSearchIndex,
            setCapacityProjectSearchIndex: result.setCapacityProjectSearchIndex,
        });
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return result;
}

test('the state layer returns the documented names in order', () => {
    assert.equal(EXPECTED_RETURN_NAMES.length, 31);
    assert.deepEqual(Object.keys(renderHook()), EXPECTED_RETURN_NAMES);
});

test('a fresh hook holds empty drafts, is clean and snapshots the capacity draft as a string', () => {
    const result = renderHook();
    assert.equal(result.capacityProjectDraft, '');
    assert.equal(result.capacityFieldIdDraft, '');
    assert.equal(result.capacityFieldNameDraft, '');
    assert.equal(result.isCapacityDraftDirty, false);
    assert.equal(result.draftSnapshot, JSON.stringify({ project: '', fieldId: '', fieldName: '' }));
    assert.deepEqual(result.capacityProjectSearchResults, []);
    assert.deepEqual(result.capacityFieldSearchResults, [{ id: 'customfield_1', name: 'Capacity' }]);
    assert.equal(result.capacityFieldSearchHidden, 0);
    assert.equal(result.resolveCapacityProjectName('AAA'), 'Alpha');
    assert.equal(result.resolveCapacityProjectName('ZZZ'), '');
});

test('every function return is callable', () => {
    const result = renderHook();
    for (const name of EXPECTED_RETURN_NAMES) {
        if (/^(load|save|apply|handle|resolve|set)/.test(name)) assert.equal(typeof result[name], 'function', name);
    }
});
