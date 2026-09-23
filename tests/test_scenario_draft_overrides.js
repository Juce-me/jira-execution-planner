const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const modulePath = path.join(__dirname, '..', 'frontend', 'src', 'scenario', 'scenarioDraftOverrides.js');

function loadModule() {
    const output = esbuild.buildSync({ entryPoints: [modulePath], bundle: true, write: false, format: 'cjs', platform: 'node' });
    const module = { exports: {} };
    new Function('module', 'exports', output.outputFiles[0].text)(module, module.exports);
    return module.exports;
}

test('normalizes canonical issue-key start/end overrides and drops empty values', () => {
    const api = loadModule();
    assert.deepEqual(api.normalizeScenarioDraftOverrides({
        ' PLAN-2 ': { start: '', end: '2026-09-26' },
        'PLAN-1': { start: '2026-09-22', end: '2026-09-25' },
        'PLAN-3': { start_date: '2026-09-22' },
        invalid: { start: '2026-09-22' },
    }), {
        'PLAN-2': { start: '', end: '2026-09-26' },
        'PLAN-1': { start: '2026-09-22', end: '2026-09-25' },
    });
});

test('signature is stable regardless of insertion order', () => {
    const api = loadModule();
    const a = { 'PLAN-2': { start: '', end: '2026-09-26' }, 'PLAN-1': { start: '2026-09-22', end: '' } };
    const b = { 'PLAN-1': { start: '2026-09-22', end: '' }, 'PLAN-2': { start: '', end: '2026-09-26' } };
    assert.equal(api.scenarioDraftOverridesSignature(a), api.scenarioDraftOverridesSignature(b));
});
