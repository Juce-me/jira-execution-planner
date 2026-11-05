// useEngSprintData owns `workTypes`: set only by full Catch Up reads, lanes merged, reset on a context change.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

const keys = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
const workTypes = (planning, parent, parentCount, ancestorCount, mismatchKeys) => ({
    digest: 'd1', observed: { planning, parent }, linkMismatches: { parentCount, ancestorCount, keys: mismatchKeys },
});

function harness(respond) {
    const requests = [];
    const fetchEngTasks = async (url, options) => {
        requests.push(options);
        return new Response(JSON.stringify({ issues: [], epics: {}, epicsInScope: [], ...respond(options) }));
    };
    const api = { fetchEngTasks, fetchEpicRefresh: fetchEngTasks, fetchBacklogEpics: async () => ({ epics: [] }), fetchEpicAlertBundle: fetchEngTasks,
        fetchEpicBacklog: async () => ({ epics: [] }), fetchEpicMissingInfo: fetchEngTasks, fetchEpicReadyToClose: fetchEngTasks };
    let props = {};
    const base = {
        workModel: 'legacy', workContextKey: 'k1', backendUrl: 'https://synthetic.invalid', selectedSprint: '1', activeGroupId: 'g', activeGroupTeamIds: ['t'],
        activeGroupTeamSet: new Set(['t']), activeGroupTeamLabels: {}, pageLoadRefreshRef: { current: false }, registerSprintFetch: () => new AbortController(),
        cleanupSprintFetch: () => {},
    };
    for (const key of ['setLoading', 'setError', 'setEpicDetails', 'setProductEpicsInScope', 'setTechEpicsInScope']) base[key] = () => {};
    const mounted = mountBundledHook({ entry: path.resolve('frontend/src/eng/useEngSprintData.js'), exportName: 'useEngSprintData',
        modules: { '../api/engApi.js': api }, makeProps: () => ({ ...base, ...props }) });
    return { mounted, requests, setProps: next => { props = next; } };
}

async function quietly(run) {
    const log = console.log;
    console.log = () => {};
    try { return await run(); } finally { console.log = log; }
}

test('workTypes is null until a full read reports it', async () => {
    const h = harness(() => ({}));
    assert.equal(h.mounted.render().workTypes, null);
    await quietly(() => h.mounted.result.fetchTasks('product'));
    assert.equal(h.mounted.render().workTypes, null, 'a response without workTypes leaves it null');
});

test('two lanes merge: counts summed, keys unioned up to 20, observed names from either lane', async () => {
    const byLane = {
        product: workTypes('Epic', null, 12, 0, keys('P', 12)),
        tech: workTypes(null, 'Initiative', 13, 2, [...keys('P', 4), ...keys('T', 9)]),
    };
    const h = harness(options => ({ workTypes: byLane[options.project] }));
    h.mounted.render();
    await quietly(() => h.mounted.result.fetchTasks('product'));
    await quietly(() => h.mounted.result.fetchTasks('tech'));
    const merged = h.mounted.render().workTypes;
    assert.equal(merged.digest, 'd1');
    assert.deepEqual(merged.observed, { planning: 'Epic', parent: 'Initiative' });
    assert.equal(merged.linkMismatches.parentCount, 25);
    assert.equal(merged.linkMismatches.ancestorCount, 2);
    assert.equal(merged.linkMismatches.keys.length, 20);
    assert.equal(new Set(merged.linkMismatches.keys).size, 20);
    assert.deepEqual(merged.linkMismatches.keys.slice(0, 12), keys('P', 12));

    // A lane re-read replaces that lane; it never double-counts.
    await quietly(() => h.mounted.result.fetchTasks('product'));
    assert.equal(h.mounted.render().workTypes.linkMismatches.parentCount, 25);
});

test('automatic, epic-refresh and non-Catch Up reads never overwrite workTypes', async () => {
    let current = workTypes('Epic', 'Initiative', 1, 0, ['P-1']);
    const h = harness(() => ({ workTypes: current }));
    h.mounted.render();
    await quietly(() => h.mounted.result.fetchTasks('product'));
    const before = h.mounted.render().workTypes;
    assert.equal(before.observed.planning, 'Epic');
    current = workTypes('Changed', 'Changed', 9, 9, ['X-1']);
    await quietly(() => h.mounted.result.fetchTasks('product', { automatic: true }));
    await quietly(() => h.mounted.result.fetchTasks('product', { background: true }));
    await quietly(() => h.mounted.result.fetchTasks('product', { epicRefresh: true, epicKeys: ['E-1'] }));
    await quietly(() => h.mounted.result.fetchTasks('product', { purpose: 'alerts' }));
    await quietly(() => h.mounted.result.fetchTasks('product', { purpose: 'ready-to-close' }));
    assert.deepEqual(h.mounted.render().workTypes, before);
    assert.equal(h.requests.length, 6);
});

test('a work context change resets workTypes to null; a read for the new context sets it again', async () => {
    const h = harness(() => ({ workTypes: workTypes('Epic', 'Initiative', 1, 0, ['P-1']) }));
    h.mounted.render();
    await quietly(() => h.mounted.result.fetchTasks('product'));
    assert.ok(h.mounted.render().workTypes);
    h.setProps({ workContextKey: 'k2' });
    assert.equal(h.mounted.render().workTypes, null);
    await quietly(() => h.mounted.result.fetchTasks('product'));
    assert.equal(h.mounted.render().workTypes.linkMismatches.parentCount, 1);
});
