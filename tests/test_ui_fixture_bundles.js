const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const source = fs.readFileSync(path.join(__dirname, 'ui/fixture_bundles.js'), 'utf8');
after(() => esbuild.stop());

function fixture(t) {
    const scratch = path.join(__dirname, '..', 'tmp');
    fs.mkdirSync(scratch, { recursive: true });
    const root = fs.mkdtempSync(path.join(scratch, 'ui-bundle-cache-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'frontend/src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'value.js'), 'export const value = "before";');
    fs.writeFileSync(path.join(dir, 'dashboard.jsx'), 'import { value } from "./value.js"; globalThis.fixtureValue = value + KIND;');
    const counts = { sync: 0, async: 0 };
    const delegate = { ...esbuild,
        buildSync(options) { counts.sync++; return esbuild.buildSync(options); },
        build(options) { counts.async++; return esbuild.build(options); },
    };
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', source)(name => name === 'esbuild' ? delegate : require(name), mod, mod.exports);
    const options = { absWorkingDir: root, entryPoints: ['frontend/src/dashboard.jsx'],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { KIND: '"a"' }, logLevel: 'silent' };
    return { root, dir, counts, cache: mod.exports, options };
}

test('separate spec callers share one compiled bundle but receive private buffers', t => {
    const { counts, cache, options } = fixture(t);
    const a = cache.buildSync(options);
    const expected = a.outputFiles[0].text;
    a.outputFiles[0].contents.fill(0);
    const b = cache.buildSync({ ...options });
    assert.equal(counts.sync, 1);
    assert.equal(b.outputFiles[0].text, expected);
    assert.equal(b.metafile, undefined);
});

test('changed dependency contents invalidate reuse', t => {
    const { dir, counts, cache, options } = fixture(t);
    cache.buildSync(options);
    const input = path.join(dir, 'value.js');
    const before = fs.statSync(input);
    fs.writeFileSync(input, 'export const value = "after!";');
    fs.utimesSync(input, before.atime, before.mtime);
    assert.match(cache.buildSync(options).outputFiles[0].text, /after!/);
    assert.equal(counts.sync, 2);
});

test('package resolution metadata invalidates reuse and build variants remain separate', t => {
    const { root, counts, cache, options } = fixture(t);
    cache.buildSync(options);
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"synthetic-fixture"}');
    cache.buildSync(options);
    cache.buildSync({ ...options, define: { KIND: '"b"' } });
    assert.equal(counts.sync, 3);
});

test('concurrent async callers and later sync callers reuse the same successful build', async t => {
    const { counts, cache, options } = fixture(t);
    const [a, b] = await Promise.all([cache.build(options), cache.build(options)]);
    assert.equal(a.outputFiles[0].text, b.outputFiles[0].text);
    cache.buildSync(options);
    assert.deepEqual(counts, { sync: 0, async: 1 });
});

test('failed compilation is never retained as a successful cached fixture', t => {
    const { dir, counts, cache, options } = fixture(t);
    fs.rmSync(path.join(dir, 'value.js'));
    assert.throws(() => cache.buildSync(options), /Could not resolve/);
    fs.writeFileSync(path.join(dir, 'value.js'), 'export const value = "repaired";');
    assert.match(cache.buildSync(options).outputFiles[0].text, /repaired/);
    assert.equal(counts.sync, 2);
});

test('instrumentation plugins stay uncached and execute for each request', async t => {
    const { counts, cache, options } = fixture(t);
    let setups = 0;
    const instrumented = { ...options, plugins: [{ name: 'synthetic-observer', setup() { setups++; } }] };
    await cache.build(instrumented);
    await cache.build(instrumented);
    assert.equal(setups, 2);
    assert.equal(counts.async, 2);
});


test('bundled JavaScript and CSS outputs remain intact and independently copied', t => {
    const { dir, counts, cache, options } = fixture(t);
    fs.writeFileSync(path.join(dir, 'dashboard.jsx'), 'import "./fixture.css"; globalThis.fixtureValue = KIND;');
    fs.writeFileSync(path.join(dir, 'fixture.css'), 'body { color: red; }');
    const multiple = { ...options, loader: {}, outdir: 'out' };
    const first = cache.buildSync(multiple);
    const css = first.outputFiles.find(output => output.path.endsWith('.css'));
    assert.match(css.text, /color: red/);
    css.contents.fill(0);
    const second = cache.buildSync(multiple);
    assert.match(second.outputFiles.find(output => output.path.endsWith('.css')).text, /color: red/);
    assert.match(second.outputFiles.find(output => output.path.endsWith('.js')).text, /fixtureValue/);
    assert.equal(counts.sync, 1);
});


test('new higher-priority module candidates invalidate previously resolved inputs', t => {
    const { dir, counts, cache, options } = fixture(t);
    fs.writeFileSync(path.join(dir, 'dashboard.jsx'), 'import { value } from "./value"; globalThis.fixtureValue = value;');
    assert.match(cache.buildSync(options).outputFiles[0].text, /before/);
    fs.writeFileSync(path.join(dir, 'value.jsx'), 'export const value = "new-resolution";');
    assert.match(cache.buildSync(options).outputFiles[0].text, /new-resolution/);
    assert.equal(counts.sync, 2);
});
