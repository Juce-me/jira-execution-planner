const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function load(globals = {}, buildId) {
    const result = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../frontend/src/components/lazyViewLoaders.js')], bundle: true, format: 'cjs', platform: 'node', write: false, define: buildId ? { __JEP_DASHBOARD_BUILD_ID__: JSON.stringify(buildId) } : {} });
    const module = { exports: {} };
    vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, URL, Error, fetch: global.fetch, ...globals });
    return module.exports;
}
const buildId = 'a'.repeat(64);
function manifest() {
    return { schemaVersion: 1, buildId, views: {
        stats: { path: 'chunks/StatsPanel-ABC12345.js', exportName: 'default' },
        scenario: { path: 'chunks/ScenarioView-ABC12345.js', exportName: 'ScenarioView' },
        settings: { path: 'chunks/SettingsModalContainer-ABC12345.js', exportName: 'default' },
    } };
}
test('lazy manifests accept only the complete mounted graph and fixed exports', () => {
    const { validateLazyViewManifest } = load();
    const result = validateLazyViewManifest(manifest(), buildId);
    assert.equal(result.views.scenario.exportName, 'ScenarioView');
    for (const mutate of [
        m => { m.schemaVersion = 2; }, m => { m.extra = true; }, m => { m.views.stats.extra = true; }, m => { m.buildId = 'b'.repeat(64); },
        m => { delete m.views.settings; }, m => { m.views.extra = m.views.stats; },
        m => { m.views.scenario.exportName = 'default'; },
        ...['../StatsPanel-ABC12345.js', '/chunks/StatsPanel-ABC12345.js', 'https://evil.example/chunks/StatsPanel-ABC12345.js', 'chunks/../StatsPanel-ABC12345.js', 'chunks/StatsPanel-ABC12345.js?q=1', 'chunks/StatsPanel-ABC12345.js#x', 'chunks/StatsPanel-%41BC12345.js', 'chunks\\StatsPanel-ABC12345.js', 'chunks/ScenarioView-ABC12345.js'].map(value => m => { m.views.stats.path = value; }),
    ]) {
        const value = manifest(); mutate(value);
        assert.throws(() => validateLazyViewManifest(value, buildId), error => error.code === 'JEP_STALE_LAZY_BUILD');
    }
});
test('lazy loader caches initial success across attempts and reopen', async () => {
    const { createLazyViewLoader } = load();
    let calls = 0;
    const module = { default() {} };
    const loader = createLazyViewLoader({ viewId: 'stats', initialLoad: async () => { calls += 1; return module; } });
    assert.equal(await loader(0), module);
    assert.equal(await loader(1), module);
    assert.equal(await loader(0), module);
    assert.equal(calls, 1);
});
test('lazy loader preserves normalized named Scenario imports', async () => {
    const { createLazyViewLoader } = load();
    const ScenarioView = () => null;
    const loader = createLazyViewLoader({ viewId: 'scenario', initialLoad: async () => ({ default: ScenarioView }) });
    assert.equal((await loader(0)).default, ScenarioView);
    assert.throws(() => createLazyViewLoader({ viewId: 'unknown', initialLoad() {} }));
});
test('lazy loader never repeats a failed original import for explicit retry', async () => {
    const { createLazyViewLoader } = load();
    let calls = 0;
    const loader = createLazyViewLoader({ viewId: 'stats', initialLoad: async () => { calls += 1; throw new Error('asset failed'); } });
    await assert.rejects(loader(0), /asset failed/);
    await assert.rejects(loader(1), error => error.code === 'JEP_STALE_LAZY_BUILD');
    assert.equal(calls, 1);
});

test('lazy retry caches only a validated mounted manifest and uses its versioned URL', async () => {
    const requests = [];
    const { createLazyViewLoader } = load({
        document: { baseURI: 'https://app.example/', getElementById: id => id === 'dashboard-entry' ? { src: 'https://app.example/frontend/dist/dashboard.js' } : null },
        window: { location: { origin: 'https://app.example' } },
        fetch: async url => { requests.push(url); return { ok: true, json: async () => manifest() }; },
    }, buildId);
    for (const viewId of ['stats', 'scenario']) {
        const loader = createLazyViewLoader({ viewId, initialLoad: async () => { throw new Error('original failed'); } });
        // Native imports require the browser; in this VM they reject after manifest validation.
        await assert.rejects(loader(1), error => error.code !== 'JEP_STALE_LAZY_BUILD');
    }
    assert.deepEqual(requests, [`https://app.example/frontend/dist/lazy-views-${buildId}.json`]);
});
test('every load failure is tagged so the boundary can tell it from a view render error', async () => {
    const { createLazyViewLoader, isLazyLoadFailure, STALE_LAZY_BUILD_CODE } = load();
    const settled = loader => loader.then(() => null, error => error);
    const failing = createLazyViewLoader({ viewId: 'stats', initialLoad: async () => { throw new Error('asset failed'); } });
    assert.equal(isLazyLoadFailure(await settled(failing(0))), true);
    const stale = await settled(failing(1));
    assert.equal(isLazyLoadFailure(stale), true);
    assert.equal(stale.code, STALE_LAZY_BUILD_CODE);
    assert.equal(isLazyLoadFailure(await settled(createLazyViewLoader({ viewId: 'stats', initialLoad: async () => ({}) })(0))), true);
    const plain = await settled(createLazyViewLoader({ viewId: 'stats', initialLoad: async () => { throw 'plain'; } })(0));
    assert.equal(isLazyLoadFailure(plain), true);
    assert.ok(plain instanceof Error);
    assert.equal(isLazyLoadFailure(new Error('render bug')), false);
});

test('concurrent retries share one manifest read', async () => {
    let requests = 0;
    const { createLazyViewLoader } = load({
        document: { baseURI: 'https://app.example/', getElementById: () => ({ src: 'https://app.example/frontend/dist/dashboard.js' }) },
        window: { location: { origin: 'https://app.example' } },
        fetch: async () => { requests += 1; await new Promise(resolve => setTimeout(resolve, 0)); return { ok: true, json: async () => manifest() }; },
    }, buildId);
    const loaders = ['stats', 'scenario', 'settings'].map(viewId => createLazyViewLoader({ viewId, initialLoad: async () => { throw new Error('original failed'); } }));
    await Promise.all(loaders.map(loader => loader(1).catch(() => null)));
    assert.equal(requests, 1);
});

test('the committed manifest passes the runtime validator', () => {
    const dist = path.join(__dirname, '../frontend/dist');
    const names = fs.readdirSync(dist).filter(file => /^lazy-views-[a-f0-9]{64}\.json$/.test(file));
    assert.equal(names.length, 1);
    const id = names[0].slice('lazy-views-'.length, -'.json'.length);
    const { validateLazyViewManifest } = load();
    assert.equal(validateLazyViewManifest(JSON.parse(fs.readFileSync(path.join(dist, names[0]), 'utf8')), id).buildId, id);
});
test('missing or mismatched manifests fail stale without importing a newer graph', async () => {
    for (const response of [{ ok: false }, { ok: true, json: async () => ({ ...manifest(), buildId: 'b'.repeat(64) }) }]) {
        let requests = 0;
        const { createLazyViewLoader } = load({
            document: { baseURI: 'https://app.example/', getElementById: () => ({ src: 'https://app.example/frontend/dist/dashboard.js' }) },
            window: { location: { origin: 'https://app.example' } },
            fetch: async () => { requests += 1; return response; },
        }, buildId);
        const loader = createLazyViewLoader({ viewId: 'stats', initialLoad() {} });
        await assert.rejects(loader(1), error => error.code === 'JEP_STALE_LAZY_BUILD');
        await assert.rejects(loader(1), error => error.code === 'JEP_STALE_LAZY_BUILD');
        assert.equal(requests, 2, 'failed manifest reads are not cached');
    }
});
