const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function harness(request) {
    const source = fs.readFileSync('frontend/src/eng/useEngSprintData.js', 'utf8')
        .replace(/^import\s+[^;]+;\s*$/gm, '').replaceAll('export const ', 'const ').replaceAll('export function ', 'function ');
    const effects = [], reads = [], finished = [], requests = [];
    const dependencies = { fetchEngTasks: async (url, options) => { requests.push(options); return request(options); },
        fetchEpicRefresh: async (url, options) => request(options), isAuthenticationRequiredError: error => error.name === 'AuthenticationRequiredError',
        PRIORITY_ORDER: [], filterEpicsByTaskEpicKeys: epics => epics, filterEpicsInScopeForTeamSet: items => items,
        filterTasksForTeamSet: items => items, sortTasksByPriority: items => items, flattenTeamLabelAliases: () => [] };
    const hook = new Function(...Object.keys(dependencies), `${source}; return useEngSprintData;`)(...Object.values(dependencies));
    const props = { backendUrl: 'https://synthetic.invalid', selectedSprint: '1', activeGroupId: 'sample', activeGroupTeamIds: ['t'],
        activeGroupTeamSet: new Set(['t']), pageLoadRefreshRef: { current: true }, registerSprintFetch: () => new AbortController(),
        cleanupSprintFetch: () => {}, onServerConnectionFailure: () => effects.push('outage'), issueEditState: {
            beginRead: () => { const token = {}; reads.push(token); return token; }, finishRead: token => finished.push(token),
            capturePlanningBases: () => {}, notePlanningRawRead: () => {}, reconcileIssues: items => items, overlayPlanningIssues: items => items,
        } };
    for (const key of ['setLoading', 'setError', 'setEpicDetails', 'setProductEpicsInScope', 'setTechEpicsInScope']) props[key] = () => effects.push(key);
    return { api: hook(props), props, effects, reads, finished, requests };
}
const response = payload => new Response(JSON.stringify(payload));
const job = () => ({ signal: new AbortController().signal, pendingSources: ['eng_product', 'eng_tech'], shouldApply: () => true });

test('automatic collector is silent, forced and retains both leases until acceptance/disposal', async () => {
    const h = harness(() => response({ issues: [], epics: {}, epicsInScope: [] }));
    const result = await h.api.collectGroupRefresh(job(), { sameScope: () => true });
    assert.deepEqual(h.effects, []);
    assert.equal(h.props.pageLoadRefreshRef.current, true);
    assert.equal(h.finished.length, 0);
    assert.deepEqual(h.requests.map(options => [options.refresh, options.automatic]), [[true, true], [true, true]]);
    assert.equal(result.product.coverage, 'unknown');
    result.release(); result.release();
    assert.deepEqual(h.finished, h.reads);
});
test('automatic network failure never hands ownership to global connection recovery', async () => {
    const h = harness(() => { throw new Error('offline'); });
    const result = await h.api.collectGroupRefresh(job(), { sameScope: () => true });
    assert.equal(result.product.status, 'failed'); assert.deepEqual(h.effects, []);
    result.release(); assert.deepEqual(h.finished, h.reads);
});
for (const targeted of [false, true]) {
    test(`${targeted ? 'targeted' : 'scope'} denial preserves access classification`, async () => {
        const h = harness(() => new Response(JSON.stringify({ error: 'missing_project_access', projectAccessStatus: 'inaccessible' }), { status: 403 }));
        const result = targeted ? await h.api.loadEpicRefresh({ epicKey: 'EPIC-1', automatic: true }) : await h.api.collectGroupRefresh(job(), { sameScope: () => true });
        assert.equal(result.product.status, 'denied'); assert.equal(result.product.projectAccessStatus, 'inaccessible'); result.release();
        assert.deepEqual(h.finished, h.reads);
    });
    for (const body of [true, false]) test(`${targeted ? 'targeted' : 'scope'} Retry-After from ${body ? 'body' : 'header'}`, async () => {
        const h = harness(() => new Response(JSON.stringify({ error: 'epic_refresh_rate_limited', ...(body ? { retryAfterSeconds: 7 } : {}) }), { status: 429, headers: { 'Retry-After': '9' } }));
        const result = targeted ? await h.api.loadEpicRefresh({ epicKey: 'EPIC-1', automatic: true }) : await h.api.collectGroupRefresh(job(), { sameScope: () => true });
        assert.equal(result.product.status, 'rate_limited'); assert.equal(result.product.retryAfterSeconds, body ? 7 : 9); result.release();
    });
}
test('late scope version is ignored and leases finish once', async () => {
    let release; const wait = new Promise(resolve => { release = resolve; }); let current = true;
    const h = harness(async () => { await wait; return response({ issues: [{ key: 'S-1' }] }); });
    const pending = h.api.collectGroupRefresh(job(), { sameScope: () => current }); current = false; release();
    const result = await pending; assert.equal(result.product.status, 'ignored'); result.release();
    assert.deepEqual(h.effects, []); assert.deepEqual(h.finished, h.reads);
});
test('terminal auth propagates even after scope retirement and releases every acquired lease', async () => {
    const h = harness(() => { throw Object.assign(new Error('sign in'), { name: 'AuthenticationRequiredError' }); });
    await assert.rejects(h.api.collectGroupRefresh(job(), { sameScope: () => false }), { name: 'AuthenticationRequiredError' });
    assert.deepEqual(h.finished, h.reads); assert.deepEqual(h.effects, []);
});

function scopeApplierHarness(extra = {}) {
    const { mountBundledHook } = require('./react_hook_harness');
    const path = require('node:path');
    const state = { productTasks: [], techTasks: [], loadedProductTasks: [], loadedTechTasks: [], epicDetails: {},
        productEpicsInScope: [], techEpicsInScope: [], readyToCloseProductEpicsInScope: [], readyToCloseTechEpicsInScope: [],
        readyToCloseProductTasks: [], readyToCloseTechTasks: [], missingInfoEpics: [], missingPlanningInfoTasks: [], backlogProductEpics: [], backlogTechEpics: [] };
    const guards = { blocked: false, epoch: 1, version: 1, scopeKey: 'sample|1' };
    const hold = { current: 0 }; const effects = [];
    const setters = Object.fromEntries(Object.keys(state).map(key => [`set${key[0].toUpperCase()}${key.slice(1)}`, value => {
        assert.equal(hold.current, 1, 'capacity hold covers the synchronous commit');
        state[key] = typeof value === 'function' ? value(state[key]) : value;
    }]));
    const mounted = mountBundledHook({ entry: path.resolve('frontend/src/eng/useEpicRefresh.js'), exportName: 'useEpicRefresh',
        modules: { 'react-dom': { flushSync: fn => fn() }, '../issues/IssueCard.jsx': { REMOVE_FADE_MS: 1 } },
        makeProps: () => ({ active: false, getState: () => state, readScopeGuards: () => guards, readGuards: () => guards,
            getProtectedKeys: () => new Set(), priorityOrder: { Blocker: 1, Medium: 3, Minor: 4 }, setters,
            capacityScopeHoldRef: hold, markDependencySignature: (...args) => effects.push(args), ...extra }) });
    mounted.render();
    return { mounted, state, guards, effects, hold };
}
const issue = (key, priority = 'Medium', summary = key) => ({ key, fields: { epicKey: 'EPIC-1', summary, priority: { name: priority } } });
test('shared scope applier rejects blocked or newer department generation immediately before commit', () => {
    const h = scopeApplierHarness(); const before = { ...h.guards };
    const merged = { guards: before, lanes: { product: { status: 'ok', items: [issue('S-1')] }, tech: { status: 'ok', items: [] } } };
    h.guards.blocked = true; assert.equal(h.mounted.result.applyScopeSnapshot(job(), merged), null);
    h.guards.blocked = false; h.guards.version++;
    assert.equal(h.mounted.result.applyScopeSnapshot(job(), merged), null); assert.deepEqual(h.state.productTasks, []); assert.deepEqual(h.effects, []);
});
test('automatic acceptance retains a field edited during the read and applies unprotected remote fields', () => {
    const h = scopeApplierHarness(); const before = issue('S-1'); const edited = issue('S-1', 'Minor', 'local confirmed edit');
    h.state.productTasks = [edited]; h.state.loadedProductTasks = [edited];
    h.mounted.result.applyScopeSnapshot(job(), { guards: { ...h.guards }, requestSnapshot: new Map([[before.key, before]]),
        lanes: { product: { status: 'ok', items: [issue('S-1', 'Blocker', 'stale remote edit'), issue('S-2')] }, tech: { status: 'ignored' } } });
    assert.equal(h.state.productTasks.find(item => item.key === 'S-1'), edited); assert.equal(h.state.productTasks.length, 2);
    assert.equal(h.hold.current, 0); assert.equal(h.effects.length, 1);
});
test('automatic final sort uses Planning originals and restores the display overlay after sorting', async () => {
    const { createEngIssueEditState } = await import('../frontend/src/eng/engIssueEditState.js');
    const editState = createEngIssueEditState();
    editState.reservePlanningEdit({ issueKey: 'S-1', field: 'priority', prior: { name: 'Minor' }, optimistic: { name: 'Blocker' }, scope: 'sample|1' });
    const h = scopeApplierHarness({ getPlanningOriginals: editState.planningOriginals, overlayPlanningIssues: editState.overlayPlanningIssues });
    const items = [issue('S-1', 'Blocker'), issue('S-2')];
    h.mounted.result.applyScopeSnapshot(job(), { guards: { ...h.guards }, lanes: { product: { status: 'ok', items }, tech: { status: 'ignored' } } });
    assert.deepEqual(h.state.productTasks.map(item => item.key), ['S-2', 'S-1']);
    assert.equal(h.state.productTasks[1].fields.priority.name, 'Blocker');
    assert.equal(editState.planningPhase('S-1', 'priority'), 'pending');
});

test('Catch Up adapter sequences targeted lanes before broad lanes, disposes leases, and reports actual outcomes', async () => {
    const { createCatchUpFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const calls = [], state = { loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} };
    const input = { loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, activeGroupId: 'sample', selectedSprint: '1',
        issueEditState: { planningEntries: () => [] }, epicRefresh: { readState: () => state,
            refreshEpic: async (key, options) => { calls.push(['anchor', key, options]); return { changedKeys: [], addedKeys: [], silentKeys: [], lanes: { product: { status: 'failed' }, tech: { status: 'ok' } } }; },
            applyScopeSnapshot: () => { calls.push('apply'); return { changedKeys: [], addedKeys: [], silentKeys: [], fetchedStories: [] }; } },
        collectGroupRefresh: async () => { calls.push('scope'); return { product: { status: 'rate_limited', retryAfterSeconds: 3 }, tech: { status: 'ok' }, release: () => calls.push('release') }; } };
    const adapter = createCatchUpFreshnessAdapter(() => input, { now: () => 1000 }); const currentJob = { ...job(), anchorSignal: new AbortController().signal };
    const anchor = { epicKey: 'EPIC-1' };
    assert.equal((await adapter.refreshAnchor(currentJob, anchor))[0].status, 'failed');
    const descriptors = await adapter.refreshScope(currentJob, anchor);
    assert.deepEqual(calls.map(item => Array.isArray(item) ? item[0] : item), ['anchor', 'scope', 'apply', 'release']);
    assert.equal(descriptors[0].retryAtMs, 4000); assert.equal(descriptors[1].checkKind, 'forced'); assert.equal(descriptors[1].coverage, 'unknown');
    assert.equal(calls[0][2].deferFollowUps, true);
});
test('adapter disposal runs for a retired broad response and synthetic NO_EPIC never dispatches targeted reads', async () => {
    const { createCatchUpFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    let eligible = true, releases = 0, applications = 0, anchors = 0;
    const input = { loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, activeGroupId: 'sample', selectedSprint: '1',
        epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [] }), refreshEpic: () => { anchors++; }, applyScopeSnapshot: () => { applications++; } },
        collectGroupRefresh: async () => { eligible = false; return { release: () => releases++ }; } };
    const adapter = createCatchUpFreshnessAdapter(() => input); const currentJob = { ...job(), shouldApply: () => eligible };
    assert.deepEqual(await adapter.refreshAnchor(currentJob, { epicKey: 'NO_EPIC' }), []);
    assert.deepEqual(await adapter.refreshScope(currentJob, null), [{ source: 'eng_product', status: 'ignored' }, { source: 'eng_tech', status: 'ignored' }]);
    assert.equal(releases, 1); assert.equal(applications, 0); assert.equal(anchors, 0);
});
test('explicit Refresh rejects catalog/config promises and records only accepted forced ENG lanes in the current context', async () => {
    const { createDashboardFreshnessOwners } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const accepted = [];
    const freshness = { ownersRef: { current: null }, automaticRefreshRef: { current: null }, acceptChecks: value => accepted.push(value) };
    const input = { loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, activeGroupId: 'sample', selectedSprint: '1',
        selectedView: 'eng', acceptedBoardConfigRef: { current: true }, authResumePrincipalRef: { current: {} }, connectionRecoveryPrincipalRef: { current: {} }, connectionUnavailableRef: { current: false }, alertCohortRef: { current: null } };
    freshness.ownersRef.current = createDashboardFreshnessOwners(freshness, input);
    freshness.ownersRef.current.recordExplicitRefresh('catch_up', Promise.resolve(true));
    freshness.ownersRef.current.recordExplicitRefresh('catch_up', { product: Promise.resolve('applied'), tech: Promise.resolve('non_auth_failure'), primaryReady: false });
    await Promise.resolve(); assert.equal(accepted.length, 1); assert.equal(accepted[0].checks[0].source, 'eng_product'); assert.equal(accepted[0].checks[0].coverage, 'unknown');
});

test('scope accepts new storyless Epics without deleting unproven held Epic membership', () => {
    const h = scopeApplierHarness(); const held = { key: 'EPIC-1', summary: 'held' }, incoming = { key: 'EPIC-2', summary: 'storyless' };
    h.state.productEpicsInScope = [held];
    h.mounted.result.applyScopeSnapshot(job(), { guards: { ...h.guards }, lanes: { product: { status: 'ok', items: [], meta: { epicsInScope: [incoming], epics: { 'EPIC-2': incoming } } }, tech: { status: 'ignored' } } });
    assert.deepEqual(h.state.productEpicsInScope, [held, incoming]); assert.equal(h.state.productEpicsInScope[0], held);
    assert.equal(h.state.epicDetails['EPIC-2'], incoming);
});
test('inaccessible scope clears lane Stories and scope/copy cards while surviving lane references stay stable', () => {
    const h = scopeApplierHarness(); const product = issue('S-1'), tech = { ...issue('T-1'), fields: { ...issue('T-1').fields, epicKey: 'EPIC-2' } };
    h.state.productTasks = [product]; h.state.loadedProductTasks = [product]; h.state.productEpicsInScope = [{ key: 'EPIC-1' }];
    h.state.readyToCloseProductTasks = [product]; h.state.readyToCloseProductEpicsInScope = [{ key: 'EPIC-1' }];
    h.state.techTasks = [tech]; h.state.loadedTechTasks = [tech]; h.state.techEpicsInScope = [{ key: 'EPIC-2' }];
    h.state.epicDetails = { 'EPIC-1': { key: 'EPIC-1' }, 'EPIC-2': { key: 'EPIC-2' } };
    const otherTasks = h.state.techTasks, otherScope = h.state.techEpicsInScope, otherEpic = h.state.epicDetails['EPIC-2'];
    h.mounted.result.applyScopeSnapshot(job(), { guards: { ...h.guards }, lanes: { product: { status: 'denied', projectAccessStatus: 'inaccessible' }, tech: { status: 'ignored' } } });
    for (const key of ['productTasks', 'loadedProductTasks', 'productEpicsInScope', 'readyToCloseProductTasks', 'readyToCloseProductEpicsInScope']) assert.deepEqual(h.state[key], []);
    assert.equal(h.state.techTasks, otherTasks); assert.equal(h.state.techEpicsInScope, otherScope); assert.equal(h.state.epicDetails['EPIC-2'], otherEpic);
    assert.equal('EPIC-1' in h.state.epicDetails, false);
});

test('automatic subtasks reload only expanded changed anchor Stories, retain failed data and never release mutation locks', async () => {
    const { mountBundledHook } = require('./react_hook_harness'); const path = require('node:path');
    const calls = [], finished = []; let fail = false, locks = 0;
    const editState = { beginRead: () => 'read', finishRead: token => finished.push(token), reconcileIssues: items => items,
        releasePlanningLocks: () => { locks++; }, planningEvidence: () => new Set() };
    const mounted = mountBundledHook({ entry: path.resolve('frontend/src/issues/useStorySubtasks.js'), exportName: 'useStorySubtasks',
        modules: { '../api/engApi.js': { fetchStorySubtasks: async (_url, options) => { calls.push(options); if (fail) throw new Error('offline'); return response({ subtasks: [{ key: 'CHILD-1' }], cached: true }); } },
            '../api/authRequired.js': { isAuthenticationRequiredError: () => false } },
        makeProps: () => ({ backendUrl: 'https://synthetic.invalid', selectedSprint: '1', issueEditState: editState }) });
    mounted.render();
    mounted.result.toggleStorySubtasks({ key: 'S-1' }); mounted.result.toggleStorySubtasks({ key: 'S-2' });
    await new Promise(resolve => setImmediate(resolve)); mounted.render();
    fail = true;
    mounted.result.invalidateStorySubtasks(['S-1', 'S-2'], { job: job(), anchorKeys: new Set(['S-1']) });
    await new Promise(resolve => setImmediate(resolve)); mounted.render();
    assert.deepEqual(calls.slice(2).map(call => [call.parentKey, call.automatic]), [['S-1', true]]);
    assert.deepEqual(mounted.result.storySubtasksByKey['S-1'].items, [{ key: 'CHILD-1' }]);
    assert.equal(mounted.result.storySubtasksByKey['S-2'].loaded, false);
    assert.equal(locks, 0); assert.deepEqual(finished, ['read']);
});

test('inaccessible acceptance removes readiness-only lane content before a failed follow-up and preserves shared keys', async () => {
    const { createCatchUpFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const denied = { key: 'EPIC-9', projectClass: 'product' }, surviving = { key: 'EPIC-2', projectClass: 'tech' };
    let snapshot = { schemaVersion: 1, complete: true, scope: { groupId: 'sample', sprintId: '1' }, epics: [denied, surviving] };
    let loads = 0;
    const h = scopeApplierHarness({ mergeReadinessEpic: (key, payload) => { snapshot = { ...snapshot, epics: snapshot.epics.filter(item => item.key !== key) }; assert.deepEqual(payload.epics, []); } });
    h.state.productEpicsInScope = [{ key: 'EPIC-2' }]; h.state.techEpicsInScope = [surviving];
    h.state.readyToCloseProductEpicsInScope = [denied]; h.state.missingInfoEpics = [denied, surviving];
    h.state.missingPlanningInfoTasks = [{ key: 'S-9', fields: { epicKey: denied.key } }];
    h.state.backlogProductEpics = [denied];
    const input = { loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, activeGroupId: 'sample', selectedSprint: '1',
        epicRefresh: h.mounted.result, storyReadiness: { get snapshot() { return snapshot; }, loadEpic: async () => { loads++; return { status: 'failed' }; } },
        collectGroupRefresh: async () => ({ product: { status: 'denied', projectAccessStatus: 'inaccessible' }, tech: { status: 'failed' }, release: () => {} }),
        loadAlertEpics: async () => {}, fetchMissingPlanningInfo: async () => {}, loadReadyToCloseProductTasks: async () => {}, loadReadyToCloseTechTasks: async () => {},
        invalidateStorySubtasks: () => {} };
    const adapter = createCatchUpFreshnessAdapter(() => input); const currentJob = job();
    await adapter.refreshScope(currentJob, { epicKey: denied.key });
    assert.deepEqual(snapshot.epics, [surviving]); assert.equal(snapshot.epics[0], surviving);
    assert.deepEqual(h.state.missingInfoEpics, [surviving]); assert.deepEqual(h.state.missingPlanningInfoTasks, []);
    await adapter.followUp(currentJob); assert.equal(loads, 0, 'denied anchor readiness must not resurrect');
});

test('automatic subtask settlement preserves a user collapse while the read is held', async () => {
    const { mountBundledHook } = require('./react_hook_harness'); const path = require('node:path');
    let resolveRead; let calls = 0;
    const mounted = mountBundledHook({ entry: path.resolve('frontend/src/issues/useStorySubtasks.js'), exportName: 'useStorySubtasks',
        modules: { '../api/engApi.js': { fetchStorySubtasks: async () => ++calls === 1 ? response({ subtasks: [{ key: 'CHILD-1' }] }) : new Promise(resolve => { resolveRead = resolve; }) },
            '../api/authRequired.js': { isAuthenticationRequiredError: () => false } },
        makeProps: () => ({ backendUrl: 'https://synthetic.invalid', selectedSprint: '1' }) });
    mounted.render(); mounted.result.toggleStorySubtasks({ key: 'S-1' }); await new Promise(resolve => setImmediate(resolve)); mounted.render();
    const settled = mounted.result.invalidateStorySubtasks(['S-1'], { job: job(), anchorKeys: new Set(['S-1']) });
    mounted.render(); mounted.result.toggleStorySubtasks({ key: 'S-1' }); mounted.render();
    resolveRead(response({ subtasks: [{ key: 'CHILD-2' }] })); await settled; mounted.render();
    assert.equal(mounted.result.storySubtasksByKey['S-1'].expanded, false);
    assert.deepEqual(mounted.result.storySubtasksByKey['S-1'].items, [{ key: 'CHILD-2' }]);
});

test('freshness blocked guard reads only signals the dashboard supplies', () => {
    const adapters = fs.readFileSync('frontend/src/dashboardFreshnessAdapters.js', 'utf8');
    for (const phantom of ['openPopover', 'pendingCapacityMutation', 'surfaceBlocked']) {
        assert.equal(adapters.includes(phantom), false, `${phantom} is never supplied by dashboard.jsx; capacity editor state is covered by capacityInteractionRef and field popovers by issueFieldEdits.activeEditor`);
    }
});
