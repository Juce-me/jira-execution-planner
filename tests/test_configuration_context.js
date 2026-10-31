const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const source = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'frontend', 'src', 'workStructure', 'configurationContext.js')],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
}).outputFiles[0].text;
const sandbox = { module: { exports: {} }, exports: {}, console, URLSearchParams };
vm.runInContext(source, vm.createContext(sandbox));
const ctx = sandbox.module.exports;
const requestSource = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'frontend', 'src', 'workStructure', 'requestContext.js')],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
}).outputFiles[0].text;
const requestSandbox = { module: { exports: {} }, exports: {}, console, URLSearchParams, AbortController, DOMException };
vm.runInContext(requestSource, vm.createContext(requestSandbox));
const requests = requestSandbox.module.exports;

const LEGACY = { id: 'legacy', name: 'Legacy', revision: 3, model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' };
const DELIVERY = { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null };

test('quarters are strict canonical YYYYQ1-4 strings', () => {
    for (const valid of ['2027Q1', '0001Q4', '9999Q2']) assert.equal(ctx.canonicalQuarter(valid), valid);
    for (const invalid of ['2027q1', ' 2027Q1', '2027Q1 ', '2027Q5', '2027Q0', '27Q1', '0000Q1', '2027-Q1', '20271', '', null, undefined, 2027, '2027Q1\n'])
        assert.equal(ctx.canonicalQuarter(invalid), null, String(invalid));
});

test('quarter arithmetic and calendar helpers stay inside 0001-9999', () => {
    assert.equal(ctx.nextQuarter('2026Q4'), '2027Q1');
    assert.equal(ctx.quarterFromIndex(ctx.quarterIndex('0001Q1')), '0001Q1');
    assert.equal(ctx.nextQuarter('9999Q4'), null);
    assert.equal(ctx.calendarQuarter(new Date(2027, 0, 15)), '2027Q1');
    assert.equal(ctx.calendarQuarter(new Date(2026, 11, 31)), '2026Q4');
});

test('sprint names yield a quarter only at token boundaries', () => {
    assert.equal(ctx.quarterFromSprintName('2026Q4'), '2026Q4');
    assert.equal(ctx.quarterFromSprintName('2026Q4 Sprint 3'), '2026Q4');
    assert.equal(ctx.quarterFromSprintName('Sprint 42'), null);
    assert.equal(ctx.quarterFromSprintName('x12026Q41'), null);
    assert.equal(ctx.quarterFromSprintName(null), null);
});

test('a quarter resolves from ranges with Legacy consulted first', () => {
    assert.equal(ctx.configurationForQuarter([DELIVERY, LEGACY], '2026Q4').id, 'legacy');
    assert.equal(ctx.configurationForQuarter([LEGACY, DELIVERY], '2027Q1').id, 'delivery');
    assert.equal(ctx.configurationForQuarter([LEGACY, DELIVERY], '0001Q1').id, 'legacy');
    assert.equal(ctx.configurationForQuarter([LEGACY, DELIVERY], '9999Q4').id, 'delivery');
    const overlapping = [{ ...DELIVERY, fromQuarter: '2026Q3' }, LEGACY];
    assert.equal(ctx.configurationForQuarter(overlapping, '2026Q4').id, 'legacy');
    assert.equal(ctx.configurationForQuarter([LEGACY], '2027Q1'), null);
    assert.equal(ctx.configurationForQuarter([LEGACY, DELIVERY], 'bogus'), null);
    assert.equal(ctx.configurationForQuarter(null, '2027Q1'), null);
});

test('context stamp is immutable, requires an integer revision and never carries invalid quarters', () => {
    const stamp = ctx.buildConfigurationContext(DELIVERY, '2027Q1');
    assert.deepEqual({ id: stamp.id, revision: stamp.revision, quarter: stamp.quarter, digest: stamp.digest }, { id: 'delivery', revision: 2, quarter: '2027Q1', digest: null });
    assert.ok(Object.isFrozen(stamp));
    assert.equal(ctx.buildConfigurationContext(DELIVERY, '2027q1'), null);
    assert.equal(ctx.buildConfigurationContext({ ...DELIVERY, revision: undefined }, '2027Q1'), null);
    assert.equal(ctx.buildConfigurationContext(null, '2027Q1'), null);
});

test('selector fields and body carry id, revision and quarter; params merge without fabricating anything', () => {
    const stamp = ctx.buildConfigurationContext({ ...LEGACY, digest: 'd1' }, '2026Q4');
    assert.deepEqual({ ...ctx.contextSelector(stamp) }, { configurationId: 'legacy', configurationRevision: '3', quarter: '2026Q4', configurationDigest: 'd1' });
    const params = ctx.applyContextToParams(new URLSearchParams({ sprint: '9' }), stamp, { includeQuarter: false });
    assert.equal(params.get('configurationId'), 'legacy');
    assert.equal(params.get('quarter'), null);
    assert.equal(params.get('sprint'), '9');
    assert.deepEqual({ ...ctx.contextBody(null) }, {});
    assert.equal(ctx.applyContextToParams(new URLSearchParams(), null).toString(), '');
});

test('contexts compare by id, revision, digest and quarter; catalog identity ignores the quarter', () => {
    const a = ctx.buildConfigurationContext(DELIVERY, '2027Q1');
    const sameConfigOtherQuarter = ctx.buildConfigurationContext(DELIVERY, '2027Q2');
    const newRevision = ctx.buildConfigurationContext({ ...DELIVERY, revision: 3 }, '2027Q1');
    assert.equal(ctx.sameContext(a, ctx.buildConfigurationContext(DELIVERY, '2027Q1')), true);
    assert.equal(ctx.sameContext(a, sameConfigOtherQuarter), false);
    assert.equal(ctx.sameCatalogContext(a, sameConfigOtherQuarter), true);
    assert.equal(ctx.sameCatalogContext(a, newRevision), false);
    assert.equal(ctx.sameContext(null, null), true);
    assert.equal(ctx.sameContext(a, null), false);
});

test('a response answering for another configuration or revision is rejected', () => {
    const stamp = ctx.buildConfigurationContext(DELIVERY, '2027Q1');
    assert.equal(ctx.responseMatchesContext(stamp, { configurationId: 'delivery', configurationRevision: 2 }), true);
    assert.equal(ctx.responseMatchesContext(stamp, { configurationId: 'legacy', configurationRevision: 2 }), false);
    assert.equal(ctx.responseMatchesContext(stamp, { configurationId: 'delivery', configurationRevision: 1 }), false);
    assert.equal(ctx.responseMatchesContext(stamp, undefined), true);
});

test('dropdown candidates are deduplicated and bounded without enumerating the open range', () => {
    const list = ctx.quarterCandidates({
        observed: ['2026Q4', '2026Q4', 'junk'], privateQuarter: '2027Q1', now: new Date(2026, 10, 1), summaries: [LEGACY, DELIVERY],
    });
    assert.deepEqual([...list], ['2026Q4', '2027Q1']);
    const wide = ctx.quarterCandidates({ observed: [], privateQuarter: '2030Q2', now: new Date(2026, 5, 1), summaries: [LEGACY, DELIVERY] });
    assert.deepEqual([...wide], ['2026Q2', '2026Q3', '2026Q4', '2027Q1', '2030Q2']);
});

test('unavailable rows carry the quarter and a suffix, never an id', () => {
    assert.equal(ctx.unavailableQuarterLabel('2027Q1', 'setup_required'), '2027Q1 — setup required');
    assert.equal(ctx.unavailableQuarterLabel('2027Q1', 'not_observed'), '2027Q1 — not observed');
    assert.equal(ctx.unavailableQuarterLabel('2027Q1', 'unknown'), '2027Q1');
});

test('admission: only the matching configuration catalog admits a Sprint; a mismatched retained id is rejected', () => {
    const summaries = [LEGACY, DELIVERY];
    const legacySprints = [{ id: 7, name: '2026Q4', state: 'active' }];
    const onlyLegacy = ctx.resolveQuarterAdmission({ quarter: '2027Q1', summaries, missingByConfiguration: {}, sprints: legacySprints, catalogSettled: true, retainedSprintId: 7 });
    assert.equal(onlyLegacy.status, 'not_observed');
    assert.equal(onlyLegacy.sprint, null);
    assert.equal(onlyLegacy.configuration.id, 'delivery');
    const setup = ctx.resolveQuarterAdmission({ quarter: '2027Q1', summaries, missingByConfiguration: { delivery: ['sprint'] }, sprints: [], catalogSettled: true });
    assert.equal(setup.status, 'setup_required');
    const pending = ctx.resolveQuarterAdmission({ quarter: '2027Q1', summaries, missingByConfiguration: {}, sprints: [], catalogSettled: false });
    assert.equal(pending.status, 'pending');
    const later = ctx.resolveQuarterAdmission({ quarter: '2027Q1', summaries, missingByConfiguration: {}, sprints: [{ id: 91, name: '2027Q1', state: 'future' }], catalogSettled: true });
    assert.equal(later.status, 'admitted');
    assert.equal(later.sprint.id, 91);
    assert.equal(ctx.resolveQuarterAdmission({ quarter: '2030Q1', summaries: [LEGACY], missingByConfiguration: {}, sprints: [], catalogSettled: true }).status, 'no_configuration');
    assert.equal(ctx.resolveQuarterAdmission({ quarter: 'bad', summaries, sprints: [] }).status, 'no_quarter');
});

test('request context stamps work requests and drops a completion that outlives its context', async () => {
    const delivery = ctx.buildConfigurationContext(DELIVERY, '2027Q1');
    const legacy = ctx.buildConfigurationContext(LEGACY, '2026Q4');
    requests.setActiveWorkContext(delivery);
    const params = requests.stampParams(new URLSearchParams({ sprint: '91' }));
    assert.deepEqual(Object.fromEntries(params), { sprint: '91', configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1' });
    assert.deepEqual({ ...requests.stampBody({ keys: ['A-1'] }) }, { keys: ['A-1'], configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1' });

    // Completed under the same context: accepted.
    assert.equal(await requests.runInWorkContext({}, async () => 'ok'), 'ok');

    // The context changes while the request is in flight: its signal aborts and a late success is rejected.
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    let seenSignal;
    const pending = requests.runInWorkContext({}, async (init) => { seenSignal = init.signal; await hold; return 'late'; });
    requests.setActiveWorkContext(legacy);
    assert.equal(seenSignal.aborted, true);
    release();
    await assert.rejects(pending, error => error.name === 'AbortError' && error.code === 'configuration_context_changed');

    // The caller's own signal still aborts a request.
    const outer = new AbortController();
    let relayed;
    const cancelled = requests.runInWorkContext({ signal: outer.signal }, async (init) => { relayed = init.signal; await new Promise(() => {}); });
    outer.abort();
    assert.equal(relayed.aborted, true);
    requests.setActiveWorkContext(null);
    assert.equal(requests.stampParams(new URLSearchParams()).toString(), '');
    void cancelled;
});
