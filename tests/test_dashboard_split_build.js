const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '..');
const helper = path.join(repo, 'scripts/build_dashboard.mjs');
function fixture(t) {
    // tmp/ is gitignored, so a fresh checkout (CI) has none.
    fs.mkdirSync(path.join(repo, 'tmp'), { recursive: true });
    const root = fs.mkdtempSync(path.join(repo, 'tmp/dashboard-split-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const put = (name, body) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body); };
    put('package.json', '{"private":true}'); put('package-lock.json', '{}');
    put('scripts/build_dashboard.mjs', fs.readFileSync(helper));
    put('frontend/src/dashboard.jsx', `console.log(__JEP_DASHBOARD_BUILD_ID__); export const views = [() => import('./stats/StatsPanel.jsx'), () => import('./scenario/ScenarioView.jsx'), () => import('./settings/SettingsModalContainer.jsx')];`);
    put('frontend/src/stats/StatsPanel.jsx', 'export default "stats-one";');
    put('frontend/src/scenario/ScenarioView.jsx', 'export const ScenarioView = "scenario";');
    put('frontend/src/settings/SettingsModalContainer.jsx', 'export default "settings";');
    put('frontend/dist/auth-focus-refresh.js', 'auth'); put('frontend/dist/dashboard.css', 'css');
    return { root, put };
}
function bytes(root) {
    const dir = path.join(root, 'frontend/dist');
    return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter(name => fs.statSync(path.join(dir, name)).isFile()).sort().map(name => [name, fs.readFileSync(path.join(dir, name)).toString('base64')]));
}
function cli(root) { return spawnSync(process.execPath, [helper], { cwd: root, encoding: 'utf8' }); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
test('split CLI is deterministic, fingerprints lazy edits, cleans stale files and retains last good build', t => {
    const { root, put } = fixture(t);
    assert.equal(cli(root).status, 0);
    const first = bytes(root);
    assert.equal(cli(root).status, 0); assert.deepEqual(bytes(root), first);
    const manifestName = Object.keys(first).find(name => name.startsWith('lazy-views-'));
    const manifest = JSON.parse(Buffer.from(first[manifestName], 'base64'));
    assert.deepEqual(Object.keys(manifest.views), ['stats', 'scenario', 'settings']);
    assert.deepEqual(Object.values(manifest.views).map(v => v.exportName), ['default', 'ScenarioView', 'default']);
    for (const view of Object.values(manifest.views)) assert.ok(first[view.path]);
    put('frontend/src/stats/StatsPanel.jsx', 'export default "stats-two";');
    assert.equal(cli(root).status, 0);
    const second = bytes(root);
    assert.notEqual(second['dashboard.js'], first['dashboard.js']); assert.ok(!second[manifestName]);
    const nextManifest = JSON.parse(Buffer.from(second[Object.keys(second).find(name => name.startsWith('lazy-views-'))], 'base64'));
    assert.notEqual(nextManifest.views.stats.path, manifest.views.stats.path);
    assert.ok(!Object.hasOwn(second, manifest.views.stats.path));
    assert.ok(!Object.hasOwn(second, manifest.views.stats.path + '.map'));
    assert.equal(second['dashboard.css'], first['dashboard.css']); assert.equal(second['auth-focus-refresh.js'], first['auth-focus-refresh.js']);
    put('frontend/src/stats/StatsPanel.jsx', 'export default !!!');
    assert.notEqual(cli(root).status, 0); assert.deepEqual(bytes(root), second);
});
test('coordinator serializes rebuilds, discards stale snapshots and distinguishes modes', async t => {
    const { root, put } = fixture(t);
    const { createBuildCoordinator } = await import(pathToFileURL(helper));
    const esbuild = require('esbuild');
    const entered = deferred(); const release = deferred();
    let active = 0; let maximum = 0; let calls = 0; const ids = []; const published = [];
    const coordinator = createBuildCoordinator({ root, onPublish: id => published.push(id), build: async options => {
        active++; maximum = Math.max(maximum, active); calls++;
        ids.push(JSON.parse(options.define.__JEP_DASHBOARD_BUILD_ID__));
        if (calls === 1) { entered.resolve(); await release.promise; }
        try { return await esbuild.build(options); } finally { active--; }
    } });
    const pending = coordinator.requestBuild(); await entered.promise;
    put('frontend/src/stats/StatsPanel.jsx', 'export default "changed-during-build";');
    const again = coordinator.requestBuild(); release.resolve(); await Promise.all([pending, again]);
    assert.equal(maximum, 1); assert.equal(calls, 2); assert.notEqual(ids[0], ids[1]);
    assert.deepEqual(published, [ids[1]]);
    assert.ok(!fs.existsSync(path.join(root, `frontend/dist/lazy-views-${ids[0]}.json`)));
    assert.ok(fs.existsSync(path.join(root, `frontend/dist/lazy-views-${ids[1]}.json`)));
    const production = bytes(root);
    const development = createBuildCoordinator({ root, mode: 'development' }); await development.requestBuild();
    assert.notDeepEqual(bytes(root), production);
    assert.ok(!fs.existsSync(path.join(root, `frontend/dist/lazy-views-${ids[1]}.json`)));
});

test('input recheck rejects unwatched edits and snapshot loader never falls back to new disk paths', async t => {
    const { root, put } = fixture(t);
    const { createBuildCoordinator } = await import(pathToFileURL(helper));
    const esbuild = require('esbuild');
    const published = []; const ids = []; let calls = 0;
    const coordinator = createBuildCoordinator({ root, onPublish: id => published.push(id), build: async options => {
        calls++;
        ids.push(JSON.parse(options.define.__JEP_DASHBOARD_BUILD_ID__));
        if (calls === 1) {
            let load;
            options.plugins[0].setup({ onLoad(_filter, callback) { load = callback; } });
            put('frontend/src/new.js', 'export default "new";');
            assert.throws(() => load({ path: path.join(root, 'frontend/src/new.js') }), /absent from build snapshot/);
            put('frontend/src/stats/StatsPanel.jsx', 'export default "edited";');
            assert.equal(load({ path: path.join(root, 'frontend/src/stats/StatsPanel.jsx') }).contents.toString(), 'export default "stats-one";');
        }
        return esbuild.build(options);
    } });
    await coordinator.requestBuild();
    assert.equal(calls, 2); assert.deepEqual(published, [ids[1]]); assert.notEqual(ids[0], ids[1]);
});

test('watch invalidates active generations immediately and debounces only idle bursts', async t => {
    const { root, put } = fixture(t);
    const { createBuildCoordinator, watchDashboard } = await import(pathToFileURL(helper));
    const esbuild = require('esbuild');
    const entered = deferred(); const release = deferred(); const idlePublished = deferred();
    let calls = 0; let active = 0; let maximum = 0; let listener; let closed = false;
    let timerId = 0; const timers = new Map(); const publications = [];
    const coordinator = createBuildCoordinator({ root, build: async options => {
        calls++; active++; maximum = Math.max(maximum, active);
        if (calls === 1) { entered.resolve(); await release.promise; }
        try { return await esbuild.build(options); } finally { active--; }
    }, onPublish: id => { publications.push(id); if (publications.length === 2) idlePublished.resolve(); } });
    const session = watchDashboard({ root, coordinator,
        watch(directory, options, callback) {
            assert.equal(directory, path.join(root, 'frontend/src')); assert.equal(options.recursive, true);
            listener = callback; return { close() { closed = true; } };
        },
        setTimer(callback, delay) { assert.equal(delay, 50); timers.set(++timerId, callback); return timerId; },
        clearTimer(id) { timers.delete(id); }, onError: error => { throw error; },
    });
    await entered.promise;
    // A -> B -> A has identical final bytes but still invalidates the captured generation.
    put('frontend/src/stats/StatsPanel.jsx', 'export default "transient";'); listener();
    put('frontend/src/stats/StatsPanel.jsx', 'export default "stats-one";'); listener();
    assert.equal(timers.size, 0);
    release.resolve(); await session.ready;
    assert.equal(calls, 2); assert.equal(publications.length, 1); assert.equal(maximum, 1);
    assert.equal(timers.size, 0);
    put('frontend/src/stats/StatsPanel.jsx', 'export default "idle-edit";');
    listener(); listener(); listener();
    assert.equal(calls, 2); assert.equal(timers.size, 1);
    const callback = [...timers.values()][0]; timers.clear(); callback();
    await idlePublished.promise;
    assert.equal(calls, 3); assert.equal(maximum, 1); assert.equal(timers.size, 0);
    session.close(); assert.equal(closed, true);
});

test('staging, entry replacement and stale cleanup failures restore the complete previous output', async t => {
    const { createBuildCoordinator } = await import(pathToFileURL(helper));
    for (const failure of ['stage', 'entry-map', 'stale-cleanup', 'staging-cleanup']) {
        await t.test(failure, async t => {
            const { root, put } = fixture(t);
            await createBuildCoordinator({ root }).requestBuild();
            const previous = bytes(root);
            put('frontend/src/stats/StatsPanel.jsx', 'export default "replacement";');
            let injected = false;
            const publishFs = new Proxy(fs, { get(target, property) {
                const original = target[property];
                if (typeof original !== 'function') return original;
                return (...args) => {
                    const targetPath = String(args[0]);
                    const matches = (failure === 'stage' && property === 'writeFileSync' && targetPath.endsWith('dashboard.js.map'))
                        || (failure === 'entry-map' && property === 'renameSync' && String(args[1]).endsWith('dashboard.js.map'))
                        || (failure === 'stale-cleanup' && property === 'unlinkSync' && targetPath.includes('lazy-views-'))
                        || (failure === 'staging-cleanup' && property === 'rmSync' && targetPath.includes('.dashboard-build-'));
                    if (!injected && matches) { injected = true; throw new Error(`injected ${failure}`); }
                    return original.apply(target, args);
                };
            } });
            const coordinator = createBuildCoordinator({ root, publishFs });
            await assert.rejects(coordinator.requestBuild(), new RegExp(`injected ${failure}`));
            assert.equal(injected, true); assert.deepEqual(bytes(root), previous);
            assert.equal(fs.readdirSync(path.join(root, 'frontend')).some(name => name.startsWith('.dashboard-build-')), false);
            await coordinator.requestBuild(); assert.notDeepEqual(bytes(root), previous);
        });
    }
});
