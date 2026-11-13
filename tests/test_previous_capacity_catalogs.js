// Cross-configuration capacity prefill: the per-sibling catalog validator and the on-open previous-Sprint resolver
// (docs/plans/DONE-planning-capacity-prefill-cross-configuration.md, T2). Synthetic identities only.
const test = require('node:test');
const assert = require('node:assert/strict');

const loadRuntime = () => import('../frontend/src/dashboardRuntime.js');
const loadResolver = () => import('../frontend/src/eng/usePreviousCapacityCatalogs.js');

const LEGACY = { id: 'legacy', name: 'Legacy', revision: 3, digest: 'a'.repeat(32), model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' };
const DELIVERY = { id: 'delivery', name: 'DELIVERY', revision: 2, digest: 'b'.repeat(32), model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null };
const BROWSER = 'bc1:synthetic';
const legacyContext = { id: 'legacy', revision: 3, quarter: '2026Q4', digest: LEGACY.digest };
const deliveryContext = { id: 'delivery', revision: 2, quarter: '2027Q1', digest: DELIVERY.digest };
const q4 = { id: 2001, name: '2026Q4', state: 'active', startDate: '2026-10-01', configurationId: 'legacy' };
const q3 = { id: 1999, name: '2026Q3', state: 'closed', startDate: '2026-07-01', configurationId: 'legacy' };
const cache = (overrides = {}) => ({
    backend: 'postgresql', identity: 'sp1:legacy', browserContextId: BROWSER, catalogVersion: 'v1', validatedAt: '2026-11-12T09:00:00Z',
    state: 'fresh', refreshStatus: 'completed', refreshFailed: false, configurationId: 'legacy', configurationRevision: 3, ...overrides,
});
const envelope = (overrides = {}, cacheOverrides = {}) => ({ httpStatus: 200, sprints: [q3, q4], cache: cache(cacheOverrides), ...overrides });

test('sibling validator: a complete, validated, same-site catalog of the requested configuration is authority', async () => {
    const { validateSiblingSprintCatalog } = await loadRuntime();
    const result = validateSiblingSprintCatalog(envelope(), { context: legacyContext, browserContextId: BROWSER });
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.sprints.map(sprint => sprint.id), [1999, 2001]);
    const stale = validateSiblingSprintCatalog(envelope({}, { state: 'stale' }), { context: legacyContext, browserContextId: BROWSER });
    assert.equal(stale.status, 'ready', 'an aged but validated, completed snapshot stays authority, as for the viewed catalog');
});

test('sibling validator: HTTP 200 alone is not authority', async () => {
    const { validateSiblingSprintCatalog } = await loadRuntime();
    const check = (value, browserContextId = BROWSER) => validateSiblingSprintCatalog(value, { context: legacyContext, browserContextId }).status;
    assert.equal(check({ httpStatus: 200, sprints: [q4] }), 'unavailable', 'no cache envelope (cold)');
    for (const missing of ['identity', 'browserContextId', 'catalogVersion', 'validatedAt']) {
        assert.equal(check(envelope({}, { [missing]: null })), 'unavailable', missing);
    }
    assert.equal(check(envelope({}, { browserContextId: 'bc1:other-site' })), 'unavailable', 'foreign workspace or Jira site');
    assert.equal(check(envelope(), null), 'unavailable', 'no current browser context to compare with');
    assert.equal(check(envelope({}, { configurationRevision: 2 })), 'unavailable', 'stale configuration revision');
    assert.equal(check(envelope({}, { configurationId: undefined })), 'unavailable', 'no configuration stamp');
    assert.equal(check(envelope({}, { configurationRevision: undefined })), 'unavailable', 'no revision stamp');
    assert.equal(check(envelope({}, { configurationRevision: '3' })), 'ready', 'the revision compares as a number');
    assert.equal(check(envelope({}, { configurationId: 'delivery' })), 'unavailable', 'another configuration answered');
    assert.equal(check(envelope({ sprints: [q4, { ...q3, configurationId: 'delivery' }] })), 'unavailable', 'a foreign row');
    assert.equal(check(envelope({ sprints: [q4, { ...q4 }] })), 'unavailable', 'duplicate ids are not a catalog');
    assert.equal(check(envelope({ sprints: null })), 'unavailable');
    assert.equal(validateSiblingSprintCatalog(envelope(), { context: null, browserContextId: BROWSER }).status, 'unavailable');
});

test('sibling validator: pending, partial and failed refreshes are not authority', async () => {
    const { validateSiblingSprintCatalog } = await loadRuntime();
    const check = value => validateSiblingSprintCatalog(value, { context: legacyContext, browserContextId: BROWSER }).status;
    assert.equal(check(envelope({}, { refreshStatus: 'pending' })), 'pending');
    assert.equal(check(envelope({}, { state: 'refreshing' })), 'pending');
    assert.equal(check({ httpStatus: 503, error: 'catalog_refresh_pending', cache: cache({ state: 'refreshing', refreshStatus: 'pending' }) }), 'pending');
    assert.equal(check(envelope({ sources: [{ configurationId: 'legacy', state: 'refreshing' }] })), 'pending', 'partial');
    assert.equal(check(envelope({}, { state: 'failed', refreshStatus: 'failed', refreshFailed: true })), 'unavailable');
    assert.equal(check(envelope({}, { refreshFailed: true })), 'unavailable');
    assert.equal(check({ httpStatus: 502, error: 'sprint_catalog_unavailable', cache: cache() }), 'unavailable');
    assert.equal(check({ httpStatus: 409, error: 'configuration_scope_changed' }), 'unavailable');
    assert.equal(check(envelope({ sources: [{ configurationId: 'legacy', state: 'ready' }] })), 'ready');
    assert.equal(check(envelope({ sources: [{ configurationId: 'legacy', state: 'ready' }, { configurationId: 'delivery', state: 'ready' }] })), 'unavailable');
});

const reader = answers => {
    const calls = [];
    const read = async (context, options) => {
        calls.push({ context, options });
        const answer = answers[context.id];
        if (answer instanceof Error) throw answer;
        return { status: answer.httpStatus, json: async () => answer };
    };
    return { calls, read };
};
const delivery = [{ id: 3001, name: '2027Q1', state: 'future', startDate: '2027-01-04', configurationId: 'delivery' }];
const resolve = async (read, overrides = {}) => {
    const { resolvePreviousCapacitySprint } = await loadResolver();
    return resolvePreviousCapacitySprint({ sprintName: '2027Q1', summaries: [LEGACY, DELIVERY], currentContext: deliveryContext,
        currentSprints: delivery, getBrowserContextId: () => BROWSER, read, ...overrides });
};

test('resolver: reads each earlier configuration once with its own context, never a refresh, and ranks across catalogs', async () => {
    const { calls, read } = reader({ legacy: envelope() });
    const result = await resolve(read);
    assert.equal(result.state, 'ready');
    assert.equal(result.sprint.id, 2001);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].context.id, 'legacy');
    assert.equal(calls[0].context.revision, 3);
    assert.equal(calls[0].context.digest, LEGACY.digest);
    assert.deepEqual(Object.keys(calls[0].options), ['signal']);
});

test('resolver: a configuration that starts at or after the viewed quarter is not read; the viewed catalog alone answers', async () => {
    const { calls, read } = reader({});
    const legacyRows = [q3, q4];
    const result = await resolve(read, { sprintName: '2026Q4', currentContext: legacyContext, currentSprints: legacyRows });
    assert.equal(calls.length, 0);
    assert.equal(result.state, 'ready');
    assert.equal(result.sprint.id, 1999);
    assert.deepEqual(await resolve(read, { sprintName: 'Unscheduled' }), { state: 'none', sprint: null });
    assert.equal((await resolve(read, { sprintName: '2026Q3', currentContext: legacyContext, currentSprints: [q3] })).state, 'none');
});

test('resolver: unavailable, pending and ambiguous sources fail closed with distinct states', async () => {
    assert.equal((await resolve(reader({ legacy: envelope({}, { browserContextId: 'bc1:other' }) }).read)).state, 'unavailable');
    assert.equal((await resolve(reader({ legacy: envelope({}, { refreshStatus: 'pending' }) }).read)).state, 'pending');
    assert.equal((await resolve(reader({ legacy: new TypeError('network') }).read)).state, 'unavailable');
    assert.equal((await resolve(reader({}).read, { summaries: [{ ...LEGACY, revision: 'x' }, DELIVERY] })).state, 'unavailable', 'no usable context');
    const tie = envelope({ sprints: [q4, { ...q4, id: 2002, state: 'closed' }, { ...q4, id: 2003, state: 'closed', name: '2026Q4' }].map(sprint => ({ ...sprint, state: 'closed' })) });
    assert.equal((await resolve(reader({ legacy: tie }).read)).state, 'ambiguous');
    const conflict = envelope({ sprints: [{ ...delivery[0], configurationId: 'legacy', name: '2026Q4' }] });
    assert.equal((await resolve(reader({ legacy: conflict }).read)).state, 'ambiguous', 'one id, two names across catalogs');
    assert.equal((await resolve(reader({ legacy: envelope({ sprints: [] }) }).read)).state, 'none');
});

test('resolver: an expired sign-in and an abort are thrown, never reported as a state', async () => {
    const expired = Object.assign(new Error('auth'), { name: 'AuthenticationRequiredError' });
    await assert.rejects(resolve(reader({ legacy: expired }).read), error => error.name === 'AuthenticationRequiredError');
    const controller = new AbortController();
    const read = async () => { controller.abort(); return { status: 200, json: async () => envelope() }; };
    await assert.rejects(resolve(read, { signal: controller.signal }), error => error.name === 'AbortError');
});

test('resolver: the browser context is re-read when each answer arrives', async () => {
    let browser = BROWSER;
    const read = async () => { browser = 'bc1:switched'; return { status: 200, json: async () => envelope() }; };
    assert.equal((await resolve(read, { getBrowserContextId: () => browser })).state, 'unavailable');
});

test('resolver: without a viewed configuration context (unpromoted or flag off) no catalog is read; the viewed catalog alone answers', async () => {
    const { earlierCapacitySources } = await loadResolver();
    assert.deepEqual(earlierCapacitySources([LEGACY, DELIVERY], null, '2027Q1'), []);
    const { calls, read } = reader({ legacy: envelope({}, { refreshStatus: 'pending' }) });
    const result = await resolve(read, { currentContext: null, currentSprints: [q3, q4, ...delivery] });
    assert.equal(calls.length, 0);
    assert.equal(result.state, 'ready');
    assert.equal(result.sprint.id, 2001);
});
