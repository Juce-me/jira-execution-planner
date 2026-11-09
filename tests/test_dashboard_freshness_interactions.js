const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');

for (const [name, pattern, refName] of [
    ['Board', /React\.useCallback\(active => \{([^\n]+)\}, \[\]\)/, 'boardFreshnessRef'],
    ['capacity', /onInteractionChange=\{value => \{([^\n]*capacityInteractionRef[^\n]*)\}\}/, 'capacityInteractionRef'],
    ['Planning table', /onInteractionChange=\{value => \{([^\n]*planningInteractionRef[^\n]*)\}\}/, 'planningInteractionRef'],
]) test(`${name} interaction wakes freshness only on a boolean transition`, () => {
    const body = source.match(pattern)?.[1];
    assert.ok(body, 'exercise the actual App callback');
    const ref = { current: name === 'Board' ? { interaction: false } : false };
    let wakes = 0;
    const callback = new Function(refName, 'notifyPlanningInteraction', `return ${name === 'Board' ? 'active' : 'value'} => {${body}}`)(ref, update => { wakes = update(wakes); });
    callback(false); callback(false); assert.equal(wakes, 0);
    callback(true); callback(true); assert.equal(wakes, 1);
    callback(false); callback(false); assert.equal(wakes, 2);
});

test('missing Planning information propagates semantic auth and always releases its read', async () => {
    const start = source.indexOf('const fetchMissingPlanningInfo = async');
    const body = source.slice(start, source.indexOf('useEffect(() => {', start));
    assert.ok(start >= 0);
    let finished = 0, cleaned = 0, writes = 0;
    const error = Object.assign(new Error('Sign in'), { name: 'AuthenticationRequiredError' });
    const dependencies = {
        registerSprintFetch: () => new AbortController(),
        cleanupSprintFetch: () => cleaned++,
        issueEditStateRef: { current: { beginRead: () => ({}), finishRead: () => finished++, reconcileIssues: items => items } },
        activeGroupId: 'sample', activeGroupTeamIds: ['sample-team'], activeGroup: {}, BACKEND_URL: 'https://synthetic.invalid',
        requestMissingPlanningInfo: async () => { throw error; },
        setMissingPlanningInfoTasks: () => writes++, setMissingInfoEpics: () => writes++,
        isAuthenticationRequiredError: candidate => candidate === error,
    };
    const read = new Function(...Object.keys(dependencies), `${body}; return fetchMissingPlanningInfo;`)(...Object.values(dependencies));
    await assert.rejects(read('sample-sprint'), candidate => candidate === error);
    assert.equal(finished, 1); assert.equal(cleaned, 1); assert.equal(writes, 0);
});


test('preserved catalog display updates never ask a dirty Planning review to change scope', () => {
    const start = source.indexOf('onState: nextState => {') + 'onState: nextState => {'.length;
    const end = source.indexOf('\n                    },\n                });', start);
    assert.ok(start > 0 && end > start, 'exercise the actual catalog consumer');
    let current, guarded = 0, changed = 0, queued;
    const dependencies = {
        setSprintCatalogState: state => { current = state; },
        sprintCatalogControllerRef: { current: { getState: () => current } },
        selectedSprintRef: { current: 42 }, setSelectedSprint: () => changed++, setSprintName: () => {},
        planningReviewGuardRef: { current: apply => { guarded++; queued = apply; } },
        sprintCatalogValidationKey: () => 'synthetic-validation', sprintCatalogPersistedValidationRef: { current: '' },
        sprintCatalogCacheRef: { current: null }, savedPrefsRef: { current: {} },
        loadUiPrefs: () => ({ selectedSprint: 42 }), saveUiPrefs: () => {}, setSprintError: () => {},
        // Quarter-first selection is inert without a configuration context (pre-promotion).
        sprintScopeOf: () => null, selectSprintForScope: () => null, quarterFromSprintName: () => null, catalogContextKey: () => '',
        setObservedQuarters: () => {}, setSelectedQuarter: () => {}, quarterIntentRef: { current: { quarter: null, explicit: false } },
    };
    const consume = new Function(...Object.keys(dependencies), `return nextState => {${source.slice(start, end)}}`)(...Object.values(dependencies));
    consume({ authority: 'invalid', selectionPreserved: true, status: 'unknown', validatedSnapshot: null });
    consume({ authority: 'validated', selectionPreserved: true, status: 'ready', selectedSprintId: 42, validatedSnapshot: { sprints: [{ id: 99, name: 'Next' }] } });
    assert.equal(guarded, 0, 'automatic display updates cannot open the Save/Discard scope dialog');
    assert.equal(changed, 0, 'the selected Sprint remains held');
    consume({ authority: 'validated', selectionPreserved: false, status: 'ready', selectedSprintId: 99, validatedSnapshot: { sprints: [{ id: 99, name: 'Next' }] } });
    assert.equal(guarded, 1, 'manual fallback still guards a real scope change');
    assert.equal(changed, 0);
    queued(); assert.equal(changed, 1);
});

test('current catalog authority fences queued ENG acquisition without changing its strict surface or edit guards', async () => {
    const { readFreshnessEnvironment } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const { createDashboardFreshnessController } = await import('../frontend/src/dashboardFreshnessController.js');
    let validated = true, reads = 0;
    const input = {
        selectedView: 'eng', showBoard: true, strictBoardActive: true, sourceScope: 'component',
        sharedConfigReady: true, acceptedBoardConfigRef: { current: true }, engWorkspaceConfigured: true,
        isSprintCatalogValidated: () => validated,
        authResumePrincipalRef: { current: null }, connectionRecoveryPrincipalRef: { current: null },
        connectionUnavailableRef: { current: false }, loadEpochRef: { current: 1 },
        groupLoadVersionRef: { current: 1 }, alertCohortRef: { current: null },
    };
    const environment = () => ({ ...readFreshnessEnvironment(input), focused: true, authReady: true, sessionEpoch: 0 });
    const controller = createDashboardFreshnessController({ readEnvironment: environment, readAdapter: () => ({
        sources: () => ['eng_board'],
        refreshScope: async () => { reads++; return [{ source: 'eng_board', status: 'ok', checkKind: 'forced', requestStartedAtMs: Date.now() }]; },
    }) });
    const pending = controller.request({ reason: 'bfcache' });
    validated = false; // Later pageshow listener invalidates authority before the queued stage runs.
    assert.equal(environment().bootstrapReady, false);
    assert.equal(environment().blocked, false, 'catalog authority is not a user edit guard');
    assert.equal(environment().surface, 'strict_board');
    await pending;
    assert.equal(reads, 0); assert.equal(controller.getState().pending, true);
    validated = true;
    await controller.update(); await controller.update();
    assert.equal(reads, 1); assert.equal(controller.getState().pending, false);
    input.selectedView = 'epm'; validated = false;
    assert.equal(environment().bootstrapReady, true, 'the ENG catalog fence does not claim EPM authority');
    controller.dispose();
});

function normalEngLoadEffect({ cached = true, overrides = {} } = {}) {
    const guard = source.indexOf("if (!recoveringPlan && (selectedView !== 'eng' || isStatsSourceOnlyStatsView || boardScopeRequested)) return;");
    const start = source.lastIndexOf('useEffect(() => {', guard);
    const end = source.indexOf('\n\n            useEffect(() => {', guard);
    assert.ok(guard >= 0 && start >= 0 && end > guard, 'exercise the actual normal ENG load effect and dependencies');
    const calls = [], writes = [], retired = { load: 0, performance: 0, fetches: 0 };
    const scopeKey = 'planning::sample-sprint::sample-group';
    const outcomes = { APPLIED: 'applied', IGNORED: 'ignored', AUTH_REQUIRED: 'auth_required', NON_AUTH_FAILURE: 'non_auth_failure' };
    const inputs = {
        selectedView: 'eng', isStatsSourceOnlyStatsView: false, boardScopeRequested: false,
        sprintCatalogReady: true, sprintCatalogState: { selectionPreserved: false }, sprintsLoading: false,
        selectedSprint: 'sample-sprint', selectedSprintInfo: { id: 'sample-sprint' },
        activeGroupId: 'sample-group', activeGroupTeamIds: ['sample-team'], groupsLoading: false, shareViewHold: false,
        groupPreferences: { onboardingRequired: false }, planningScopeKey: scopeKey,
        pendingPlanningAuthResumeRef: { current: null }, planningAuthResumeLoadRef: { current: null },
        groupLoadVersionRef: { current: 7 }, lastLoadedSprintRef: { current: 'sample-sprint' },
        groupStateRef: { current: new Map(cached ? [['sample-group', { sprintId: 'sample-sprint', teamIdsSignature: 'sample-team', tasksFetched: true }]] : []) },
        configRefreshNonce: 0, pendingConfigRefreshRef: { current: 0 }, authResumeStagedRevision: 0,
        activePerformanceLoadRef: { current: null }, ENG_TASK_LOAD_OUTCOME: outcomes,
        setEpicDetails: value => writes.push(value), setProductEpicsInScope: value => writes.push(value),
        setTechEpicsInScope: value => writes.push(value), setMissingPlanningInfoTasks: value => writes.push(value),
        setMissingInfoEpics: value => writes.push(value), setPlanningAuthResumeLoadRevision: () => {},
        abortSprintFetches: () => retired.fetches++,
        loadMeasuredGroupTasks: options => {
            calls.push(options);
            inputs.activePerformanceLoadRef.current = { cancel: () => retired.performance++ };
            return { product: Promise.resolve(outcomes.APPLIED), tech: Promise.resolve(outcomes.APPLIED), cancel: () => retired.load++ };
        },
        ...overrides,
    };
    const capture = changes => {
        const current = { ...inputs, ...changes };
        return new Function(...Object.keys(current), 'useEffect', `return ${source.slice(start, end)}`)(
            ...Object.values(current), (callback, dependencies) => ({ callback, dependencies }),
        );
    };
    return { inputs, calls, writes, retired, capture, scopeKey };
}

test('validated normal ENG cache hit changes neither load authority nor mounted data', () => {
    const h = normalEngLoadEffect();
    assert.equal(h.capture().callback(), undefined);
    assert.equal(h.inputs.groupLoadVersionRef.current, 7);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
    assert.deepEqual(h.retired, { load: 0, performance: 0, fetches: 0 });
});

test('a pending shareable link holds the normal ENG load until it is released, unless a Planning recovery capsule needs its own load', () => {
    const held = normalEngLoadEffect({ cached: false, overrides: { shareViewHold: true } });
    assert.equal(held.capture().callback(), undefined);
    assert.equal(held.inputs.groupLoadVersionRef.current, 7, 'a held link starts no load and fences nothing');
    assert.deepEqual(held.calls, []); assert.deepEqual(held.writes, []);
    assert.notDeepEqual(held.capture({ shareViewHold: false }).dependencies, held.capture().dependencies, 'releasing the hold re-runs the effect');

    const released = normalEngLoadEffect({ cached: false });
    released.capture().callback();
    assert.equal(released.calls.length, 1, 'the same scope loads once the hold is released');

    const capsule = normalEngLoadEffect({ cached: false, overrides: { shareViewHold: true, pendingPlanningAuthResumeRef: { current: { scope: { groupId: 'sample-group', sprintId: 'sample-sprint' } } } } });
    capsule.capture().callback();
    assert.equal(capsule.calls.length, 1, 'only the recovery load can clear the capsule the link waits for');
});

for (const [name, surface] of [
    ['another top-level view', { selectedView: 'epm' }],
    ['a source-only Statistics tab', { isStatsSourceOnlyStatsView: true }],
    ['the strict Board', { boardScopeRequested: true }],
]) test(`normal ENG acquisition stays suppressed in ${name}, except for a pending Planning recovery`, () => {
    const ordinary = normalEngLoadEffect({ cached: false, overrides: surface });
    assert.equal(ordinary.capture().callback(), undefined);
    assert.deepEqual(ordinary.calls, []);
    assert.deepEqual(ordinary.writes, []);
    assert.equal(ordinary.inputs.groupLoadVersionRef.current, 7);

    const recovery = normalEngLoadEffect({ cached: true, overrides: {
        ...surface,
        pendingPlanningAuthResumeRef: { current: { scope: { groupId: 'sample-group', sprintId: 'sample-sprint' } } },
    } });
    const cleanup = recovery.capture().callback();
    assert.equal(recovery.calls.length, 1, 'a matching pending recovery must refresh its complete Department source even on a cache hit');
    assert.equal(recovery.inputs.planningAuthResumeLoadRef.current.scopeKey, recovery.scopeKey);
    assert.equal(recovery.calls[0].shouldApplyResult(), true);
    cleanup();
    assert.equal(recovery.calls[0].shouldApplyResult(), false);
});

test('held catalog display cannot authorize a normal ENG acquisition before validation', () => {
    const h = normalEngLoadEffect({ cached: false, overrides: { sprintCatalogReady: false, sprintCatalogState: { selectionPreserved: true } } });
    assert.equal(h.capture().callback(), undefined);
    assert.equal(h.inputs.groupLoadVersionRef.current, 7);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
});

test('retained same-Sprint catalog revalidation preserves the existing normal load lifetime', () => {
    const h = normalEngLoadEffect({ cached: false });
    const active = h.capture(), cleanup = active.callback();
    const held = h.capture({ sprintCatalogReady: false, sprintCatalogState: { selectionPreserved: true } });
    const validated = h.capture({ sprintCatalogReady: true, sprintCatalogState: { selectionPreserved: true } });
    assert.deepEqual(held.dependencies, active.dependencies, 'display-only revalidation must not run the existing cleanup');
    assert.deepEqual(validated.dependencies, active.dependencies, 'validation must not dispatch a second normal load');
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].shouldApplyResult(), true);
    assert.deepEqual(h.retired, { load: 0, performance: 0, fetches: 0 });
    assert.notDeepEqual(h.capture({ sprintCatalogReady: false, sprintCatalogState: { selectionPreserved: false } }).dependencies, active.dependencies, 'losing authority without retained selection must retire the lifetime');
    assert.notDeepEqual(h.capture({ sprintCatalogReady: false, sprintCatalogState: { selectionPreserved: true }, selectedSprintInfo: null }).dependencies, active.dependencies, 'a missing selected Sprint cannot preserve the lifetime');
    cleanup();
    assert.equal(h.calls[0].shouldApplyResult(), false);
    assert.deepEqual(h.retired, { load: 1, performance: 1, fetches: 1 });
});

for (const [name, cached, changes] of [
    ['uncached scope', false, {}],
    ['new Sprint', true, { selectedSprint: 'sample-next-sprint', selectedSprintInfo: { id: 'sample-next-sprint' } }],
    ['new Department', true, { activeGroupId: 'sample-other-group' }],
    ['changed Team scope', true, { activeGroupTeamIds: ['sample-other-team'] }],
    ['partial lane completion', true, { lastLoadedSprintRef: { current: null } }],
    ['forced configuration refresh', true, { configRefreshNonce: 1, pendingConfigRefreshRef: { current: 1 } }],
    ['auth recovery', true, { authResumeStagedRevision: 1, pendingPlanningAuthResumeRef: { current: { scope: { groupId: 'sample-group', sprintId: 'sample-sprint' } } } }],
]) test(`normal ENG ${name} starts one validated owner load and fences its retired completion`, async () => {
    const h = normalEngLoadEffect({ cached, overrides: changes });
    const effect = h.capture();
    if (!['uncached scope', 'partial lane completion'].includes(name)) {
        assert.notDeepEqual(effect.dependencies, h.capture({ selectedSprint: 'sample-sprint', selectedSprintInfo: { id: 'sample-sprint' }, activeGroupId: 'sample-group', activeGroupTeamIds: ['sample-team'], configRefreshNonce: 0, authResumeStagedRevision: 0 }).dependencies, 'a real scope/config/auth change must still rerun the owner');
    }
    const cleanup = effect.callback();
    assert.equal(h.calls.length, 1); assert.equal(h.inputs.groupLoadVersionRef.current, 8);
    assert.equal(h.calls[0].shouldApplyResult(), true);
    if (name === 'forced configuration refresh') assert.equal(h.inputs.pendingConfigRefreshRef.current, 0);
    if (name === 'auth recovery') {
        assert.equal(h.inputs.planningAuthResumeLoadRef.current.scopeKey, h.scopeKey);
        assert.equal(h.inputs.planningAuthResumeLoadRef.current.loadVersion, 8);
    }
    cleanup();
    assert.equal(h.inputs.groupLoadVersionRef.current, 9);
    assert.equal(h.calls[0].shouldApplyResult(), false);
    assert.deepEqual(h.retired, { load: 1, performance: 1, fetches: 1 });
    await new Promise(resolve => setImmediate(resolve));
    if (name === 'auth recovery') assert.equal(h.inputs.planningAuthResumeLoadRef.current.outcome, 'pending', 'retired recovery completions cannot settle a replacement');
});

function freshnessInput(overrides = {}) {
    return {
        selectedView: 'epm', sharedConfigReady: true, engWorkspaceConfigured: true,
        acceptedBoardConfigRef: { current: true }, authResumePrincipalRef: {}, connectionRecoveryPrincipalRef: {},
        connectionUnavailableRef: {}, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 },
        alertCohortRef: {}, ...overrides,
    };
}

async function freshnessController(input) {
    const { readFreshnessEnvironment } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const { createDashboardFreshnessController } = await import('../frontend/src/dashboardFreshnessController.js');
    let reads = 0;
    const controller = createDashboardFreshnessController({
        readEnvironment: () => ({ ...readFreshnessEnvironment(input), focused: true, authReady: true, sessionEpoch: 0 }),
        readAdapter: () => ({ sources: () => ['synthetic_source'], refreshScope: async () => {
            reads++;
            return [{ source: 'synthetic_source', status: 'ok', checkKind: 'forced', requestStartedAtMs: Date.now() }];
        } }),
    });
    return { controller, reads: () => reads };
}

test('EPM return refresh starts despite stale inactive ENG loading and clears pending intent', async () => {
    const input = freshnessInput({ loading: true, productTasksLoading: true, techTasksLoading: true });
    const h = await freshnessController(input);
    await h.controller.request({ reason: 'bfcache' });
    assert.equal(h.reads(), 1);
    assert.equal(h.controller.getState().pending, false);
});

for (const [view, flags] of [
    ['eng', ['loading', 'productTasksLoading', 'techTasksLoading']],
    ['epm', ['epmLoading']],
]) for (const flag of flags) test(`${view} genuine ${flag} defers return refresh until settled`, async () => {
    const input = freshnessInput({ selectedView: view, [flag]: true });
    const h = await freshnessController(input);
    await h.controller.request({ reason: 'bfcache' });
    assert.equal(h.reads(), 0); assert.equal(h.controller.getState().pending, true);
    input[flag] = false;
    await h.controller.update();
    assert.equal(h.reads(), 1); assert.equal(h.controller.getState().pending, false);
});

for (const [flag, value] of Object.entries({
    sharedConfigReady: false, terminalAuth: true, connectionRecoveryBlocksRefresh: true,
    showGroupManage: true, onboardingActive: true, groupsLoading: true, catalogLoading: true,
    groupSaving: true, epmConfigSaving: true, workspaceConfigConflict: true,
    issueFieldEdits: { activeEditor: {} }, pendingStatusIssueKeys: new Set(['SAMPLE-1']),
})) test(`EPM retains shared ${flag} protection despite stale ENG loading`, async () => {
    const h = await freshnessController(freshnessInput({ loading: true, productTasksLoading: true, techTasksLoading: true, [flag]: value }));
    await h.controller.request({ reason: 'bfcache' });
    assert.equal(h.reads(), 0);
});

for (const [surfaceFlags, busy] of [
    [{ selectedView: 'epm', showPlanning: true, showStats: true, showScenario: true, scenarioLoading: true,
        statsLoading: true, capacityLoading: true, planningReview: { getState: () => ({ loading: true }) }, alertCohortRef: { current: {} } }, false],
    [{ selectedView: 'eng', epmLoading: true }, false],
    [{ selectedView: 'eng', showPlanning: true, planningReview: { getState: () => ({ loading: true }) } }, true],
    [{ selectedView: 'eng', showPlanning: true, capacityLoading: true }, true],
    [{ selectedView: 'eng', showStats: true, statsLoading: true }, true],
    [{ selectedView: 'eng', showScenario: true, scenarioLoading: true }, true],
    [{ selectedView: 'eng', alertCohortRef: { current: {} } }, true],
]) test(`loading guards follow the resolved active surface: ${Object.keys(surfaceFlags).join(', ')}`, async () => {
    const { readFreshnessEnvironment } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    assert.equal(readFreshnessEnvironment(freshnessInput(surfaceFlags)).ownerBusy, busy);
});

// #323 Task 7: the Planning follow-up re-reads every displayed Team's stored numbers through the assignee capacity slot.
async function planningFreshness({ read, fetch } = {}) {
    const { readFreshnessEnvironment, createPlanningFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const { createDashboardFreshnessController } = await import('../frontend/src/dashboardFreshnessController.js');
    const { createAssigneeCapacityController, createAssigneeRefreshEntry } = await import('../frontend/src/eng/usePlanningAssigneeCapacity.js');
    const ledger = { reads: [], gets: [], patches: [] };
    const caps = { canRead: true, canSave: true };
    const capacity = createAssigneeCapacityController({ sessionEvents: null, setTimer: () => 0, clearTimer: () => {},
        readPlanned: read || (async (_u, sprintId, teamIds) => { ledger.reads.push([...teamIds]); return { sprintId, capabilities: caps, failedTeamIds: [], byTeam: Object.fromEntries(teamIds.map(id => [id, { revision: 1, planned: { value: '5', source: 'user' }, inherited: null }])) }; }),
        fetchCapacity: fetch || (async (_u, sprintId, teamId) => { ledger.gets.push(teamId); return { teamId, sprintId, revision: 1, rows: [], planned: { value: '5', source: 'user' }, inherited: null, capabilities: caps }; }),
        saveCapacity: async (_u, _s, payload) => { ledger.patches.push(payload); throw Object.assign(new Error('Server unavailable'), { status: 503 }); } });
    const owner = { assigneeCapacity: createAssigneeRefreshEntry(capacity) };
    const lane = { status: 'ok', items: [], meta: {} };
    const input = { ...freshnessInput({ selectedView: 'eng', showPlanning: true }), activeGroupId: 'synthetic', selectedSprint: 1,
        planningAutomaticReadRef: { current: 0 }, capacityInteractionRef: { current: false }, planningInteractionRef: { current: false },
        planningReview: { getState: () => ({}), refresh: async () => {} }, refreshCapacity: async () => {},
        epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }),
            applyScopeSnapshot: () => ({ settled: Promise.resolve(), changedKeys: [], addedKeys: [], silentKeys: [], fetchedStories: [] }) },
        collectGroupRefresh: async () => ({ product: lane, tech: lane, release() {} }) };
    const adapter = createPlanningFreshnessAdapter(() => input, owner);
    const controller = createDashboardFreshnessController({
        readEnvironment: () => ({ ...readFreshnessEnvironment(input), focused: true, authReady: true, sessionEpoch: 0 }), readAdapter: () => adapter });
    return { capacity, controller, input, ledger, adapter, owner };
}
const settleAll = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('Planning follow-up reads the stored numbers with the batch read in multi-Team scope and the full GET in one-Team scope', async () => {
    const multi = await planningFreshness();
    multi.capacity.setProjectionScope({ sprintId: '100', teamIds: ['A', 'B'], active: true });
    await settleAll();
    await multi.controller.request({ reason: 'bfcache' }); await settleAll();
    assert.deepEqual(multi.ledger.reads, [['A', 'B'], ['A', 'B']], 'the follow-up runs one batch read');
    assert.deepEqual(multi.ledger.gets, []);
    multi.controller.dispose();

    const one = await planningFreshness();
    one.capacity.setScope({ sprintId: '100', teamId: 'A', active: true });
    one.capacity.setProjectionScope({ sprintId: '100', teamIds: ['A'], active: true });
    await settleAll();
    await one.controller.request({ reason: 'bfcache' }); await settleAll();
    assert.deepEqual(one.ledger.gets, ['A', 'A'], 'one Team: the full GET');
    assert.deepEqual(one.ledger.reads, []);
    one.controller.dispose();
});

test('a failed draft on another Team that is not open does not block the clean Teams\' automatic projection refresh', async () => {
    const h = await planningFreshness();
    h.capacity.setProjectionScope({ sprintId: '100', teamIds: ['A', 'B'], active: true });
    h.capacity.ensureTeamDocument('A');
    await settleAll();
    h.capacity.commitTeamPlanned('A', '10');
    h.capacity.flushTeam('A');
    await settleAll();
    assert.equal(h.capacity.getTeamStatus('A').plannedSave, 'failed');
    const reads = h.ledger.reads.length;
    await h.controller.request({ reason: 'bfcache' }); await settleAll();
    assert.equal(h.ledger.reads.length, reads + 1, 'the clean Teams are refreshed');
    assert.equal(h.capacity.getPlannedNumbers().byTeam.A.value, 10, 'the failed draft is kept');
    assert.equal(h.ledger.patches.length, 1, 'nothing is resent');
    h.controller.dispose();
});

test('an automatic follow-up while an editor is open does not run, and runs after it closes', async () => {
    const h = await planningFreshness();
    h.capacity.setProjectionScope({ sprintId: '100', teamIds: ['A', 'B'], active: true });
    await settleAll();
    const reads = h.ledger.reads.length;
    h.input.capacityInteractionRef.current = true;
    await h.controller.request({ reason: 'bfcache' }); await settleAll();
    assert.equal(h.ledger.reads.length, reads, 'an open card editor blocks the follow-up');
    h.input.capacityInteractionRef.current = false;
    await h.controller.update(); await settleAll();
    assert.equal(h.ledger.reads.length, reads + 1, 'it runs once the editor closes');
    // An editor that opens after the job started: the follow-up sends no read either.
    h.input.capacityInteractionRef.current = true;
    const job = { signal: new AbortController().signal, shouldApply: () => !h.input.capacityInteractionRef.current, pendingSources: ['eng_product', 'eng_tech'] };
    await h.adapter.followUp(job); await settleAll();
    assert.equal(h.ledger.reads.length, reads + 1, 'no read while the editor is open');
    h.controller.dispose();
});
