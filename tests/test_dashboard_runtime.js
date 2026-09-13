const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const source = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'frontend', 'src', 'dashboardRuntime.js')],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
}).outputFiles[0].text;
const sandbox = { module: { exports: {} }, exports: {}, console };
vm.runInContext(source, vm.createContext(sandbox));
const { loadCachedSprintCatalog } = sandbox.module.exports;

test('cached Sprint catalog is reusable for 24 hours and rejects stale or empty data', () => {
    const now = Date.UTC(2026, 8, 12, 20, 0, 0);
    const valid = { sprintCatalog: { cachedAt: now - 1000, sprints: [{ id: 42, name: '2026Q3', state: 'active' }] } };
    assert.deepEqual(loadCachedSprintCatalog(valid, now).sprints.map(sprint => sprint.name), ['2026Q3']);
    assert.equal(loadCachedSprintCatalog({ sprintCatalog: { cachedAt: now - (24 * 60 * 60 * 1000), sprints: valid.sprintCatalog.sprints } }, now).sprints.length, 0);
    assert.equal(loadCachedSprintCatalog({ sprintCatalog: { cachedAt: now, sprints: [] } }, now).sprints.length, 0);
});
