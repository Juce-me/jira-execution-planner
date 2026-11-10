const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../frontend/src/settings/AllocationTypeSelector.jsx')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
const { default: Selector, savedAllocationSource } = mod.exports;
const saved = { configurations: [
    { model: 'legacy', fields: {} },
    { model: 'rnd_2027', fields: { allocation: { fieldId: 'customfield_10099' } }, scope: { projects: [{ key: 'SYN' }] }, hierarchy: { parentIssueTypeId: '10003', planningIssueTypeId: '10002' }, allocationTypes: [{ value: 'Dormant', type: 'product' }] },
] };

test('Department picker catalog source uses saved DELIVERY Initiative metadata', () => {
    assert.deepEqual(savedAllocationSource(saved), { fieldId: 'customfield_10099', projectKey: 'SYN', issueTypeId: '10003' });
    assert.equal(savedAllocationSource(null), null);
    assert.equal(savedAllocationSource({ configurations: [{ model: 'rnd_2027', fields: {} }] }), null);
});

test('Department picker renders only its Department classification and preserves selected values without a field', () => {
    const group = { id: 'g1', allocationTypes: [{ value: 'Growth', type: 'tech' }] };
    const markup = renderToStaticMarkup(React.createElement(Selector, { group, savedWorkConfigurations: saved, backendUrl: 'http://example.test', setGroupDraft() {} }));
    assert.match(markup, /DELIVERY Allocation/);
    assert.match(markup, /Remove tech value Growth/);
    assert.doesNotMatch(markup, /Dormant/);
    assert.match(markup, /No Allocation/);
    const missing = renderToStaticMarkup(React.createElement(Selector, { group, savedWorkConfigurations: null, setGroupDraft() {} }));
    assert.match(missing, /Ask an administrator to save/);
    assert.match(missing, /disabled=""[^>]*>Add Allocation value/);
    assert.match(missing, /Remove tech value Growth/);
});
