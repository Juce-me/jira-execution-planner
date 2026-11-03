const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const src = (...parts) => path.join(__dirname, '..', 'frontend', 'src', ...parts);
// Modules that share the request-context singleton are bundled together so they see one active context.
function bundle(entry, extra = {}) {
    const entries = Array.isArray(entry) ? entry : [entry];
    const contents = entries.map((file, index) => `export * as m${index} from ${JSON.stringify(file)};`).join('\n');
    const code = esbuild.buildSync({ stdin: { contents, resolveDir: __dirname, loader: 'js' }, bundle: true, write: false, format: 'cjs', platform: 'browser' }).outputFiles[0].text;
    const sandbox = {
        module: { exports: {} }, exports: {}, console, URLSearchParams, AbortController, DOMException, Headers, Promise,
        window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
        document: { cookie: '' }, CustomEvent: class {}, Event: class {}, ...extra,
    };
    vm.runInContext(code, vm.createContext(sandbox));
    const exported = sandbox.module.exports;
    return entries.length === 1 ? exported.m0 : exported;
}

const cohort = bundle(src('cohort', 'cohortUtils.js'));
const scope = bundle(src('stats', 'statsScope.js'));
const excluded = bundle(src('stats', 'excludedCapacityStats.js'));
const epmUtils = bundle(src('epm', 'epmProjectUtils.mjs'));

const LEGACY = Object.freeze({ id: 'legacy', revision: 3, quarter: '2026Q4', digest: 'dl' });
const LEGACY_Q3 = Object.freeze({ ...LEGACY, quarter: '2026Q3' });
const DELIVERY = Object.freeze({ id: 'delivery', revision: 2, quarter: '2027Q1', digest: 'dd' });
const DELIVERY_REV3 = Object.freeze({ ...DELIVERY, revision: 3 });
const shared = { teamIds: ['t1'], components: ['C'], adHocCapacityEpics: ['AH-1'] };

test('Last N request names the selected configuration and never sends quarters; unpromoted is unchanged', () => {
    const promoted = cohort.buildCohortRequest({ mode: 'last_n', startQuarter: '2026Q1', endQuarter: '2026Q2', ...shared, context: DELIVERY });
    assert.deepEqual({ ...promoted }, {
        mode: 'last_n', quarter: '2027Q1', configurationId: 'delivery', configurationRevision: '2', ...shared, refresh: false,
    });
    assert.equal('startQuarter' in promoted, false);
    assert.equal('endQuarter' in promoted, false);
    assert.deepEqual({ ...cohort.buildCohortRequest({ mode: 'last_n', ...shared }) }, { mode: 'last_n', ...shared, refresh: false });
    assert.deepEqual({ ...cohort.buildCohortRequest({ mode: 'created', startQuarter: '2026Q1', endQuarter: '2026Q2', ...shared, context: DELIVERY }) },
        { startQuarter: '2026Q1', endQuarter: '2026Q2', ...shared, refresh: false });
});

test('cohortQueryKey: unpromoted keys are frozen; quarter is not a cache dimension inside one configuration', () => {
    const base = { mode: 'last_n', scopeKey: 'teams::no-adhoc' };
    assert.equal(cohort.buildCohortQueryKey(base), 'last_n::::::teams::no-adhoc');
    assert.equal(cohort.buildCohortQueryKey({ mode: 'created', startQuarter: '2026Q1', endQuarter: '2026Q2', scopeKey: 's' }), '2026Q1::2026Q2::s');
    assert.equal(cohort.buildCohortQueryKey({ mode: 'closed', closedStartQuarter: '2026Q1', closedEndQuarter: '2026Q2', scopeKey: 's' }), 'closed::2026Q1::2026Q2::s');
    const q4 = cohort.buildCohortQueryKey({ ...base, context: LEGACY });
    const q3 = cohort.buildCohortQueryKey({ ...base, context: LEGACY_Q3 });
    assert.equal(q4, q3, 'same-configuration quarter change reuses the fetched window');
    assert.match(q4, /^last_n::cfg:legacy\|3\|dl::teams::no-adhoc$/);
    assert.notEqual(cohort.buildCohortQueryKey({ ...base, context: DELIVERY }), q4, 'era boundary switches the window');
    assert.notEqual(cohort.buildCohortQueryKey({ ...base, context: DELIVERY_REV3 }), cohort.buildCohortQueryKey({ ...base, context: DELIVERY }), 'revision retires cached results');
    assert.notEqual(cohort.buildCohortQueryKey({ ...base, scopeKey: 'other', context: DELIVERY }), cohort.buildCohortQueryKey({ ...base, context: DELIVERY }));
    assert.notEqual(cohort.buildCohortQueryKey({ ...base, context: DELIVERY }), cohort.buildCohortQueryKey({ mode: 'created', startQuarter: '2027Q1', endQuarter: '2027Q1', scopeKey: 'teams::no-adhoc', context: DELIVERY }));
});

test('stale Last N completions are dropped by key comparison', () => {
    const key = cohort.buildCohortQueryKey({ mode: 'last_n', scopeKey: 's', context: LEGACY });
    assert.equal(cohort.admitCohortResult(key, cohort.buildCohortQueryKey({ mode: 'last_n', scopeKey: 's', context: LEGACY_Q3 })), true);
    assert.equal(cohort.admitCohortResult(key, cohort.buildCohortQueryKey({ mode: 'last_n', scopeKey: 's', context: DELIVERY })), false);
    assert.equal(cohort.admitCohortResult(key, cohort.buildCohortQueryKey({ mode: 'last_n', scopeKey: 'other', context: LEGACY })), false);
    assert.equal(cohort.admitCohortResult('', ''), false);
});

test('409 configuration codes map to safe messages; other statuses and codes are not configuration failures', () => {
    for (const code of ['configuration_required', 'configuration_scope_changed', 'configuration_incomplete']) {
        const failure = cohort.cohortConfigurationFailure(409, { error: code });
        assert.equal(failure.code, code);
        assert.ok(failure.message && !failure.message.includes(code));
    }
    assert.equal(cohort.cohortConfigurationFailure(409, { error: 'sprint_catalog_mismatch' }), null);
    assert.equal(cohort.cohortConfigurationFailure(500, { error: 'configuration_required' }), null);
    assert.equal(cohort.cohortConfigurationFailure(409, null), null);
});

test('statsApi: Last N admission compares configuration identity, not the viewed quarter', async () => {
    const calls = [];
    const { m0: requests, m1: api } = bundle([src('workStructure', 'requestContext.js'), src('api', 'statsApi.js')], {
        fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, headers: new Headers(), clone() { return this; }, json: async () => ({}) }; },
    });
    // Same configuration, different quarter: admitted.
    const sameConfig = { ...LEGACY, fromQuarter: null, throughQuarter: null };
    requests.setActiveWorkContext(sameConfig);
    const pending = api.fetchEpicCohortStats('http://backend', { mode: 'last_n' });
    requests.setActiveWorkContext({ ...sameConfig, quarter: '2026Q3' });
    assert.equal((await pending).ok, true);
    // Era change while in flight: dropped as an abort.
    requests.setActiveWorkContext(sameConfig);
    const stale = api.fetchEpicCohortStats('http://backend', { mode: 'last_n' });
    requests.setActiveWorkContext({ ...DELIVERY });
    await assert.rejects(stale, error => error.name === 'AbortError' && error.code === 'configuration_context_changed');
    requests.setActiveWorkContext(null);
});

test('Project Track key-only requests carry the selected quarter/configuration', async () => {
    let body;
    const { m0: requests, m1: api } = bundle([src('workStructure', 'requestContext.js'), src('api', 'statsApi.js')], {
        fetch: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, status: 200, headers: new Headers(), clone() { return this; }, json: async () => ({}) }; },
    });
    requests.setActiveWorkContext(null);
    await api.fetchProjectTrackPhaseDurations('http://backend', { epicKeys: ['A-1'] });
    assert.deepEqual({ ...body }, { epicKeys: ['A-1'] });
    requests.setActiveWorkContext(DELIVERY);
    await api.fetchProjectTrackPhaseDurations('http://backend', { epicKeys: ['A-1'], refresh: true });
    assert.deepEqual({ ...body }, { epicKeys: ['A-1'], refresh: true, configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1', configurationDigest: 'dd' });
    requests.setActiveWorkContext(null);
});

test('Lead Times hook gates Last N on its own selected configuration only', () => {
    const source = require('node:fs').readFileSync(src('stats', 'useStatsData.js'), 'utf8').replace(/\s+/g, ' ');
    assert.ok(source.includes("cohortMode === 'last_n' && Boolean(workSetupScope) && (workSetupScope.status === 'setup_required' || workSetupScope.status === 'no_configuration')"));
    assert.ok(source.includes('configurationFailure') && source.includes('cohortConfigurationFailure(response.status, err)'));
    assert.ok(source.includes('admitCohortResult(requestedKey, cohortQueryKeyRef.current)'));
});

test('scope labels are model-aware and never claim SP equivalence', () => {
    const summaries = [{ id: 'legacy', name: 'Legacy', model: 'legacy' }, { id: 'delivery', name: 'DELIVERY', model: 'rnd_2027' }];
    assert.equal(scope.describeStatsScope(null, summaries), null);
    const legacy = scope.describeStatsScope(LEGACY, summaries);
    assert.equal(legacy.label, '2026Q4 · Legacy');
    assert.equal(legacy.roles.parent, 'Epic');
    const delivery = scope.describeStatsScope(DELIVERY, summaries);
    assert.equal(delivery.label, '2027Q1 · DELIVERY');
    assert.deepEqual({ ...delivery.roles }, { parent: 'Initiative', parents: 'Initiatives', child: 'Epic', children: 'Epics' });
    assert.equal(/equivalen|convert/i.test(JSON.stringify(delivery)), false);
});

test('scope role words come from the summary roleTypes; roleLabels takes EntityNames', () => {
    const roleTypes = { planning: { id: '6', name: 'Capability', hierarchyLevel: 1 }, parent: { id: '7', name: 'Theme', hierarchyLevel: 2 }, ancestor: null, optionalAncestor: null };
    const summaries = [{ id: 'delivery', name: 'DELIVERY', model: 'rnd_2027', digest: 'dd', roleTypes }];
    assert.deepEqual({ ...scope.describeStatsScope(DELIVERY, summaries).roles }, { parent: 'Theme', parents: 'Themes', child: 'Capability', children: 'Capabilities' });
    assert.deepEqual({ ...scope.roleLabels(null) }, { parent: 'Epic', parents: 'Epics', child: 'Story', children: 'Stories' });
});

test('unavailable periods are distinct from zero and null points keep their missing marker', () => {
    const periods = scope.classifyPeriods([{ id: 1, name: '2026Q4 S1' }, { id: 2, name: '2027Q1 S1' }, { id: 3, name: '2027Q1 S2' }], ['1', '2'], ['2']);
    assert.deepEqual(periods.map(item => item.state), ['loaded', 'unavailable', 'unavailable']);
    assert.deepEqual([...scope.unavailablePeriodNames(periods)], ['2027Q1 S1', '2027Q1 S2']);
    const spans = scope.unavailablePeriodSpans({ unavailablePeriods: [
        { startQuarter: '2027Q1', endQuarter: '2027Q2', configurationId: 'delivery', reason: 'configuration_incomplete' },
        { startQuarter: '2027Q3', endQuarter: '2027Q3', configurationId: 'delivery', reason: 'configuration_incomplete' },
        { startQuarter: 'bad', endQuarter: '2027Q3' }, null] });
    assert.deepEqual(spans.map(span => span.label), ['2027Q1\u20132027Q2', '2027Q3']);
    assert.equal(spans[0].reason, 'configuration_incomplete');
    assert.equal(scope.sprintInContext({ name: '2027Q1 S1' }, { fromQuarter: '2027Q1', throughQuarter: null }), true);
    assert.equal(scope.sprintInContext({ name: '2026Q4 S1' }, { fromQuarter: '2027Q1', throughQuarter: null }), false);
    assert.equal(scope.sprintInContext({ name: 'no quarter' }, { fromQuarter: null, throughQuarter: null }), false);
    assert.deepEqual({ ...scope.displayStoryPoints(null) }, { text: '0 SP', missing: true });
    assert.deepEqual({ ...scope.displayStoryPoints(0) }, { text: '0 SP', missing: false });
    const merged = excluded.mergeExcludedCapacityStatsSourceChunks([
        { issues: [], meta: { warnings: [] } },
        { issues: [], meta: { warnings: ['Sprint 2 excluded capacity source failed: x'], unavailableSprintId: '2' } },
    ]);
    assert.deepEqual([...merged.meta.unavailableSprintIds], ['2']);
});

test('EPM rollups: Epic-leaf trees render Epics without Stories and count Epic points as progress', () => {
    const tree = epmUtils.buildRollupTree({
        hierarchyNames: { initiative: ['Initiative'], epic: ['Epic'] },
        initiatives: [{ issue: { key: 'I-1', summary: 'I' }, epics: [
            { issue: { key: 'E-1', status: 'Done', storyPoints: 5 }, stories: [] },
            { issue: { key: 'E-2', status: 'In Progress', storyPoints: 3 }, stories: [] },
        ], looseStories: [] }],
    });
    assert.equal(tree.kind, 'tree');
    assert.equal(tree.initiatives[0].epics.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(epmUtils.extractEpmHierarchyNames(tree))), { initiative: ['Initiative'], epic: ['Epic'] });
    assert.equal(epmUtils.extractEpmHierarchyNames(epmUtils.buildRollupTree({ initiatives: {} })), null);
    const progress = epmUtils.buildEpmProjectProgress(tree);
    assert.equal(progress.totalStoryPoints, 8);
    assert.equal(progress.doneStoryPoints, 5);
    const legacy = epmUtils.buildRollupTree({ initiatives: [{ issue: { key: 'I-1' }, epics: [{ issue: { key: 'E-1', storyPoints: 5 }, stories: [] }] }] });
    assert.equal('leafRole' in legacy, false);
    assert.equal(epmUtils.buildEpmProjectProgress(legacy), null, 'Legacy still counts Stories only');
});

test('EPM rollup requests carry the selected quarter/configuration; metadata requests do not', async () => {
    const urls = [];
    const { m0: requests, m1: api } = bundle([src('workStructure', 'requestContext.js'), src('api', 'epmApi.js')], {
        fetch: async (url) => { urls.push(String(url)); return { ok: true, status: 200, headers: new Headers(), clone() { return this; }, json: async () => ({}) }; },
    });
    requests.setActiveWorkContext(DELIVERY);
    await api.fetchEpmAllProjectsRollup('http://backend', { tab: 'active', sprint: '91' });
    await api.fetchEpmAllProjectsRollup('http://backend', { tab: 'backlog' });
    await api.fetchEpmProjects('http://backend', { tab: 'active' });
    const [active, backlog, projects] = urls.map(url => new URL(url).searchParams);
    assert.equal(active.get('configurationId'), 'delivery');
    assert.equal(active.get('configurationRevision'), '2');
    assert.equal(active.get('quarter'), '2027Q1');
    assert.equal(active.get('sprint'), '91');
    assert.equal(backlog.get('quarter'), '2027Q1');
    assert.equal(backlog.has('sprint'), false);
    assert.equal(projects.has('configurationId'), false);
    requests.setActiveWorkContext(null);
    urls.length = 0;
    await api.fetchEpmAllProjectsRollup('http://backend', { tab: 'active', sprint: '91' });
    assert.equal(new URL(urls[0]).searchParams.has('quarter'), false);
});
