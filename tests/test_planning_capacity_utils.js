const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/planningCapacityUtils.js');
}

test('getCapacityStatus preserves empty and in-band capacity states', async () => {
    const { getCapacityStatus } = await loadUtils();

    assert.deepEqual(getCapacityStatus(10, 0), { label: '', text: '', status: '', title: '' });
    assert.deepEqual(getCapacityStatus(10, 10), {
        label: '0% over',
        text: '10.0 selected | 10.0 capacity | 0% over',
        status: '',
        title: ''
    });
});

test('getCapacityStatus preserves under and over threshold copy', async () => {
    const { getCapacityStatus } = await loadUtils();

    assert.deepEqual(getCapacityStatus(8, 10), {
        label: '20% under',
        text: '8.0 selected | 10.0 capacity | 20% under',
        status: 'under',
        title: 'Please add at least 1.0 SP to reach 90%.'
    });
    assert.deepEqual(getCapacityStatus(13, 10), {
        label: '30% over',
        text: '13.0 selected | 10.0 capacity | 30% over',
        status: 'over',
        title: 'Please remove at least 1.0 SP to reach 120%.'
    });
});

test('getTeamCapacityMeta preserves remaining and over-capacity metadata', async () => {
    const { getTeamCapacityMeta } = await loadUtils();

    assert.deepEqual(getTeamCapacityMeta(0, 0), { text: '', status: '', title: '' });
    assert.deepEqual(getTeamCapacityMeta(7, 10), { text: '3.0 SP left', status: '', title: '' });
    assert.deepEqual(getTeamCapacityMeta(11, 10), {
        text: '↑ 1.0 SP · 10%',
        status: '',
        title: 'Please remove some story points or add capacity.'
    });
    assert.deepEqual(getTeamCapacityMeta(12, 10), {
        text: '↑ 2.0 SP · 20%',
        status: 'over',
        title: 'Please remove some story points or add capacity.'
    });
});

test('buildCapacityTotalsSummary subtracts excluded capacity before multiplier', async () => {
    const { buildCapacityTotalsSummary } = await loadUtils();
    const displayedTeamOptions = [{ id: 'team-a', name: 'Team A' }, { id: 'team-b', name: 'Team B' }];
    const getTeamCapacity = (name) => name === 'Team A' ? 10 : 20;

    assert.deepEqual(
        buildCapacityTotalsSummary({
            capacityEnabled: true,
            displayedTeamOptions,
            getTeamCapacity,
            excludedCapacityByTeamId: { 'team-a': 2, 'team-b': 3 },
            capacityMultiplier: 0.7
        }),
        {
            totalCapacityBase: 30,
            excludedCapacityTotal: 5,
            estimatedCapacityRaw: 25,
            totalCapacityAdjusted: 21,
            estimatedCapacityAdjusted: 17.5,
            excludedCapacityAdjusted: 3.5
        }
    );
});

test('buildProjectCapacity uses tech-heavy split and product/tech visibility gates', async () => {
    const { buildProjectCapacity } = await loadUtils();
    const displayedTeamOptions = [{ id: 'team-a', name: 'Team A' }, { id: 'team-b', name: 'Team B' }];
    const selectedTeamProjectStats = {
        'team-a': { product: 8, tech: 2 },
        'team-b': { product: 2, tech: 8 }
    };
    const getTeamNetCapacity = (team) => team.id === 'team-a' ? 10 : 20;

    assert.deepEqual(
        buildProjectCapacity({
            showPlanning: true,
            capacityEnabled: true,
            displayedTeamOptions,
            selectedTeamProjectStats,
            getTeamNetCapacity,
            capacitySplit: { product: 0.7, tech: 0.3 },
            showProduct: true,
            showTech: true
        }),
        {
            PRODUCT: 11,
            TECH: 19
        }
    );

    assert.deepEqual(
        buildProjectCapacity({
            showPlanning: true,
            capacityEnabled: true,
            displayedTeamOptions,
            selectedTeamProjectStats,
            getTeamNetCapacity,
            capacitySplit: { product: 0.7, tech: 0.3 },
            showProduct: true,
            showTech: false
        }),
        {
            PRODUCT: 11,
            TECH: 0
        }
    );
});

test('buildTeamCapacityStats groups status buckets by team and product type', async () => {
    const { buildTeamCapacityStats, buildTeamCapacityEntries } = await loadUtils();
    const normalizeStatus = value => String(value || '').trim().toLowerCase();
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const tasks = [
        { key: 'PROD-1', fields: { status: { name: 'To Do' }, customfield_10004: '3', teamId: 'team-a', teamName: 'Team A', projectKey: 'PROD' } },
        { key: 'TECH-1', fields: { status: { name: 'Accepted' }, customfield_10004: '5', teamId: 'team-a', teamName: 'Team A' } },
        { key: 'TECH-2', fields: { status: { name: 'Postponed' }, customfield_10004: 'bad', teamId: 'team-a', teamName: 'Team A' } },
        { key: 'PROD-2', fields: { status: { name: 'Pending' }, customfield_10004: '2', teamId: 'team-b', teamName: 'Team B', projectKey: 'PROD' } }
    ];

    const stats = buildTeamCapacityStats({
        showPlanning: true,
        capacityEnabled: true,
        capacityTasks: tasks,
        normalizeStatus,
        getTeamInfo,
        techProjectKeys: new Set(['TECH'])
    });

    assert.deepEqual(buildTeamCapacityEntries(stats), [
        {
            id: 'team-a',
            name: 'Team A',
            product: { todoPending: 3, accepted: 0, postponed: 0 },
            tech: { todoPending: 0, accepted: 5, postponed: 0 },
            total: { todoPending: 3, accepted: 5, postponed: 0 }
        },
        {
            id: 'team-b',
            name: 'Team B',
            product: { todoPending: 2, accepted: 0, postponed: 0 },
            tech: { todoPending: 0, accepted: 0, postponed: 0 },
            total: { todoPending: 2, accepted: 0, postponed: 0 }
        }
    ]);
});

test('buildTeamCapacityStats counts Ad Hoc Tech-project stories as Product capacity', async () => {
    const { buildTeamCapacityStats, buildTeamCapacityEntries } = await loadUtils();
    const normalizeStatus = value => String(value || '').trim().toLowerCase();
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const tasks = [
        // Tech-project story under an Ad Hoc epic -> reported as Product capacity.
        { key: 'TECH-1', fields: { status: { name: 'To Do' }, customfield_10004: '8', teamId: 'team-a', teamName: 'Team A', epicKey: 'adhoc-1' } },
        // Ordinary Tech story stays Tech.
        { key: 'TECH-2', fields: { status: { name: 'Accepted' }, customfield_10004: '5', teamId: 'team-a', teamName: 'Team A', epicKey: 'ep-9' } }
    ];

    const stats = buildTeamCapacityStats({
        showPlanning: true,
        capacityEnabled: true,
        capacityTasks: tasks,
        normalizeStatus,
        getTeamInfo,
        techProjectKeys: new Set(['TECH']),
        adHocEpicSet: new Set(['ADHOC-1'])
    });

    assert.deepEqual(buildTeamCapacityEntries(stats), [
        {
            id: 'team-a',
            name: 'Team A',
            product: { todoPending: 8, accepted: 0, postponed: 0 },
            tech: { todoPending: 0, accepted: 5, postponed: 0 },
            total: { todoPending: 8, accepted: 5, postponed: 0 }
        }
    ]);

    // Empty Ad Hoc set preserves the original Tech bucketing.
    const baseline = buildTeamCapacityStats({
        showPlanning: true,
        capacityEnabled: true,
        capacityTasks: tasks,
        normalizeStatus,
        getTeamInfo,
        techProjectKeys: new Set(['TECH'])
    });
    assert.deepEqual(buildTeamCapacityEntries(baseline), [
        {
            id: 'team-a',
            name: 'Team A',
            product: { todoPending: 0, accepted: 0, postponed: 0 },
            tech: { todoPending: 8, accepted: 5, postponed: 0 },
            total: { todoPending: 8, accepted: 5, postponed: 0 }
        }
    ]);
});

test('buildDisplayedTeamOptions filters by selected teams with story points', async () => {
    const { buildDisplayedTeamOptions, buildTeamSpTotals } = await loadUtils();
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const teamOptions = [
        { id: 'all', name: 'All Teams' },
        { id: 'team-a', name: 'Team A' },
        { id: 'team-b', name: 'Team B' }
    ];
    const teamSpTotals = buildTeamSpTotals([
        { key: 'PROD-1', fields: { customfield_10004: '3', teamId: 'team-a', teamName: 'Team A' } },
        { key: 'PROD-2', fields: { customfield_10004: '0', teamId: 'team-b', teamName: 'Team B' } }
    ], getTeamInfo);

    assert.deepEqual(teamSpTotals, { 'team-a': 3 });
    assert.deepEqual(
        buildDisplayedTeamOptions({
            teamOptions,
            isAllTeamsSelected: false,
            selectedTeamSet: new Set(['team-a', 'team-b']),
            teamSpTotals
        }),
        [{ id: 'team-a', name: 'Team A' }]
    );
});

test('buildExcludedCapacityByTeamId sums normalized excluded epics', async () => {
    const { buildExcludedCapacityByTeamId } = await loadUtils();
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const normalizeEpicKey = value => String(value || '').trim().toUpperCase();

    assert.deepEqual(
        buildExcludedCapacityByTeamId({
            capacityEnabled: true,
            showPlanning: true,
            capacityTasks: [
                { key: 'PROD-1', fields: { epicKey: 'ep-1', customfield_10004: '3', teamId: 'team-a', teamName: 'Team A' } },
                { key: 'PROD-2', fields: { epicKey: 'ep-1', customfield_10004: 'bad', teamId: 'team-a', teamName: 'Team A' } },
                { key: 'PROD-3', fields: { epicKey: 'ep-2', customfield_10004: '5', teamId: 'team-a', teamName: 'Team A' } }
            ],
            excludedEpicSet: new Set(['EP-1']),
            normalizeEpicKey,
            getTeamInfo
        }),
        { 'team-a': 3 }
    );
});

test('buildExcludedCapacityByTeamId ignores Ad Hoc epics (excluded-only path unchanged)', async () => {
    const { buildExcludedCapacityByTeamId } = await loadUtils();
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const normalizeEpicKey = value => String(value || '').trim().toUpperCase();

    // ADHOC-1 is NOT in the excluded set, so its SP must not be subtracted as excluded capacity.
    assert.deepEqual(
        buildExcludedCapacityByTeamId({
            capacityEnabled: true,
            showPlanning: true,
            capacityTasks: [
                { key: 'TECH-1', fields: { epicKey: 'adhoc-1', customfield_10004: '8', teamId: 'team-a', teamName: 'Team A' } },
                { key: 'PROD-1', fields: { epicKey: 'ep-1', customfield_10004: '5', teamId: 'team-a', teamName: 'Team A' } }
            ],
            excludedEpicSet: new Set(['EP-1']),
            normalizeEpicKey,
            getTeamInfo
        }),
        { 'team-a': 5 }
    );
});

test('Ad Hoc-reclassified team project stats drive product/tech capacity split', async () => {
    const { buildProjectCapacity } = await loadUtils();
    const { buildSelectedTeamProjectStats } = await import('../frontend/src/eng/planningSelectionStats.js');
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const techProjectKeys = new Set(['TECH']);
    const adHocEpicSet = new Set(['ADHOC-1']);

    // Tech-project Ad Hoc story (8 SP) becomes Product, flipping the team from tech-heavy to product.
    const selectedTeamProjectStats = buildSelectedTeamProjectStats([
        { key: 'TECH-1', fields: { epicKey: 'adhoc-1', customfield_10004: '8', teamId: 'team-a', teamName: 'Team A' } },
        { key: 'TECH-2', fields: { customfield_10004: '2', teamId: 'team-a', teamName: 'Team A' } }
    ], getTeamInfo, techProjectKeys, adHocEpicSet);

    assert.deepEqual(selectedTeamProjectStats, { 'team-a': { product: 8, tech: 2 } });

    const capacity = buildProjectCapacity({
        showPlanning: true,
        capacityEnabled: true,
        displayedTeamOptions: [{ id: 'team-a', name: 'Team A' }],
        selectedTeamProjectStats,
        getTeamNetCapacity: () => 10,
        capacitySplit: { product: 0.7, tech: 0.3 },
        showProduct: true,
        showTech: true
    });

    assert.deepEqual(capacity, { PRODUCT: 7, TECH: 3 });
});

test('buildSelected entries and capacity totals preserve display ordering and zero states', async () => {
    const { buildCapacityTotals, buildSelectedProjectEntries, buildSelectedTeamEntries } = await loadUtils();

    assert.deepEqual(buildCapacityTotals({ showPlanning: false, capacityEnabled: true, displayedTeamCapacityEntries: [] }), {
        product: { todoPending: 0, accepted: 0, postponed: 0 },
        tech: { todoPending: 0, accepted: 0, postponed: 0 },
        total: { todoPending: 0, accepted: 0, postponed: 0 }
    });

    assert.deepEqual(
        buildCapacityTotals({
            showPlanning: true,
            capacityEnabled: true,
            displayedTeamCapacityEntries: [
                {
                    product: { todoPending: 1, accepted: 2, postponed: 3 },
                    tech: { todoPending: 4, accepted: 5, postponed: 6 },
                    total: { todoPending: 5, accepted: 7, postponed: 9 }
                }
            ]
        }),
        {
            product: { todoPending: 1, accepted: 2, postponed: 3 },
            tech: { todoPending: 4, accepted: 5, postponed: 6 },
            total: { todoPending: 5, accepted: 7, postponed: 9 }
        }
    );

    assert.deepEqual(
        buildSelectedProjectEntries({
            showPlanning: true,
            selectedProjectStats: { TECH: 5, PRODUCT: 3, OTHER: 1 },
            capacityEnabled: true,
            projectCapacity: { TECH: 10, PRODUCT: 8 }
        }).map(entry => entry.id),
        ['PRODUCT', 'TECH', 'OTHER']
    );

    assert.deepEqual(
        buildSelectedTeamEntries({
            showPlanning: true,
            displayedTeamOptions: [{ id: 'team-a', name: 'Team A' }],
            selectedTeamStats: { 'team-a': { storyPoints: 7 } },
            capacityEnabled: true,
            capacityByTeam: { 'team a': 10 },
            capacityTargetsByTeam: {
                'team a': { state: 'matched', issueKey: 'CAP-1', teamName: 'Team A', capacity: 10 }
            },
            getTeamCapacity: () => 10,
            getTeamNetCapacity: () => 8,
            capacityMultiplier: 0.7
        }),
        [{
            id: 'team-a',
            name: 'Team A',
            storyPoints: 7,
            teamCapacity: 7,
            planningCapacity: 5.6,
            rawCapacity: 10,
            hasCapacityValue: true,
            capacityIssueKey: 'CAP-1',
            capacityTargetTeamName: 'Team A',
            capacityTargetCapacity: 10,
            capacityTargetState: 'matched'
        }]
    );
});

test('buildCapacityReadState preserves zero and groups exact Jira targets without guessing duplicates', async () => {
    const { buildCapacityReadState } = await loadUtils();

    const state = buildCapacityReadState({
        mutationEnabled: true,
        capacities: { Alpha: 0, Beta: 5, Invalid: '7', Infinite: Infinity },
        entries: [
            { teamName: 'Alpha', issueKey: 'CAP-101', capacity: 0 },
            { teamName: 'Alpha', issueKey: 'CAP-101', capacity: 0 },
            { teamName: 'Beta', issueKey: 'CAP-102', capacity: 5 },
            { teamName: 'Beta', issueKey: 'CAP-103', capacity: 6 },
            { teamName: 'Gamma', issueKey: 'CAP-104', capacity: null },
            { teamName: '', issueKey: 'CAP-105', capacity: 9 },
            { teamName: 'Delta', issueKey: '', capacity: 9 },
        ],
    });

    assert.deepEqual(state.capacityByTeam, { alpha: 0, beta: 5 });
    assert.equal(state.mutationEnabled, true);
    assert.deepEqual(state.capacityTargetsByTeam.alpha, {
        state: 'matched',
        issueKey: 'CAP-101',
        teamName: 'Alpha',
        capacity: 0,
    });
    assert.deepEqual(state.capacityTargetsByTeam.beta, { state: 'ambiguous' });
    assert.deepEqual(state.capacityTargetsByTeam.gamma, {
        state: 'matched',
        issueKey: 'CAP-104',
        teamName: 'Gamma',
        capacity: null,
    });

    for (const mutationEnabled of [false, undefined, 1, 'true', null]) {
        assert.equal(buildCapacityReadState({ mutationEnabled }).mutationEnabled, false);
    }
});

test('capacity resolvers use exact normalized matches and only one containment fallback', async () => {
    const {
        resolveUniqueCapacityTarget,
        resolveUniqueCapacityValue,
    } = await loadUtils();
    const values = { alpha: 3, 'alpha core': 5 };
    const targets = {
        alpha: { state: 'matched', issueKey: 'CAP-1', teamName: 'Alpha', capacity: null },
        'alpha core': { state: 'matched', issueKey: 'CAP-2', teamName: 'Alpha Core', capacity: 5 },
    };

    assert.deepEqual(resolveUniqueCapacityValue(values, 'R&D Alpha'), { matched: true, value: 3 });
    assert.deepEqual(resolveUniqueCapacityValue(values, 'Core'), { matched: true, value: 5 });
    assert.deepEqual(resolveUniqueCapacityValue(values, 'Alpha Core Platform'), { matched: false, value: null });
    assert.deepEqual(resolveUniqueCapacityValue({ 'alpha core': 0 }, 'Alpha'), { matched: true, value: 0 });
    assert.deepEqual(resolveUniqueCapacityTarget(targets, 'Product - Alpha'), targets.alpha);
    assert.deepEqual(resolveUniqueCapacityTarget(targets, 'Alpha Core Platform'), { state: 'ambiguous' });
    assert.deepEqual(resolveUniqueCapacityTarget({}, 'Alpha'), { state: 'missing' });
});

test('buildSelectedTeamEntries separates numeric display capacity from exact mutation targets', async () => {
    const { buildSelectedTeamEntries, resolveUniqueCapacityValue } = await loadUtils();
    const capacityByTeam = { 'alpha core': 5, beta: 0 };
    const capacityTargetsByTeam = {
        alpha: { state: 'matched', issueKey: 'CAP-1', teamName: 'Alpha', capacity: null },
        beta: { state: 'ambiguous' },
    };
    const getTeamCapacity = (name) => {
        const resolved = resolveUniqueCapacityValue(capacityByTeam, name);
        return resolved.matched ? resolved.value : 0;
    };

    assert.deepEqual(buildSelectedTeamEntries({
        showPlanning: true,
        displayedTeamOptions: [
            { id: 'alpha', name: 'Alpha' },
            { id: 'beta', name: 'Beta' },
            { id: 'missing', name: 'Missing' },
        ],
        selectedTeamStats: {},
        capacityEnabled: true,
        capacityByTeam,
        capacityTargetsByTeam,
        getTeamCapacity,
        getTeamNetCapacity: team => getTeamCapacity(team.name),
        capacityMultiplier: 0.7,
    }), [
        {
            id: 'alpha', name: 'Alpha', storyPoints: 0,
            teamCapacity: 3.5, planningCapacity: 3.5,
            rawCapacity: 5, hasCapacityValue: true,
            capacityIssueKey: 'CAP-1', capacityTargetTeamName: 'Alpha',
            capacityTargetCapacity: null, capacityTargetState: 'matched',
        },
        {
            id: 'beta', name: 'Beta', storyPoints: 0,
            teamCapacity: 0, planningCapacity: 0,
            rawCapacity: 0, hasCapacityValue: true,
            capacityIssueKey: '', capacityTargetTeamName: '',
            capacityTargetCapacity: null, capacityTargetState: 'ambiguous',
        },
        {
            id: 'missing', name: 'Missing', storyPoints: 0,
            teamCapacity: 0, planningCapacity: 0,
            rawCapacity: null, hasCapacityValue: false,
            capacityIssueKey: '', capacityTargetTeamName: '',
            capacityTargetCapacity: null, capacityTargetState: 'missing',
        },
    ]);
});

test('applyCapacitySaveResult immutably updates only an exact canonical issue target', async () => {
    const { applyCapacitySaveResult } = await loadUtils();
    const state = {
        capacityByTeam: { alpha: 5, beta: 8 },
        capacityTargetsByTeam: {
            alpha: { state: 'matched', issueKey: 'CAP-1', teamName: 'Alpha', capacity: 5 },
            beta: { state: 'matched', issueKey: 'CAP-2', teamName: 'Beta', capacity: 8 },
        },
        mutationEnabled: true,
        scopeSignature: 'scope-a',
    };

    const updated = applyCapacitySaveResult(state, { issueKey: 'CAP-1', teamName: 'R&D Alpha', capacity: 0 });
    assert.notEqual(updated, state);
    assert.notEqual(updated.capacityByTeam, state.capacityByTeam);
    assert.notEqual(updated.capacityTargetsByTeam, state.capacityTargetsByTeam);
    assert.deepEqual(updated.capacityByTeam, { alpha: 0, beta: 8 });
    assert.deepEqual(updated.capacityTargetsByTeam.alpha, {
        state: 'matched', issueKey: 'CAP-1', teamName: 'Alpha', capacity: 0,
    });
    assert.equal(updated.mutationEnabled, true);
    assert.equal(updated.scopeSignature, 'scope-a');
    assert.equal(state.capacityByTeam.alpha, 5);
    assert.equal(applyCapacitySaveResult(state, { issueKey: 'CAP-X', teamName: 'Alpha', capacity: 9 }), state);
    assert.equal(applyCapacitySaveResult(state, { issueKey: 'CAP-1', teamName: 'Alpha Core', capacity: 9 }), state);
    assert.equal(applyCapacitySaveResult(state, { issueKey: 'CAP-1', teamName: 'Alpha', capacity: Infinity }), state);
});

test('parseCapacityDraft accepts finite non-negative numbers without coercing blank input to zero', async () => {
    const { parseCapacityDraft } = await loadUtils();
    const cases = [
        ['', false, null], ['-', false, null], ['-1', false, null],
        ['Infinity', false, null], ['abc', false, null],
        ['0', true, 0], ['-0', true, 0], ['5.5', true, 5.5], ['1e2', true, 100],
    ];
    for (const [text, valid, value] of cases) {
        assert.deepEqual(parseCapacityDraft(text), { valid, value });
    }
});

test('capacity share labels describe only one-sided planning filters', async () => {
    const { getCapacityShareLabel } = await loadUtils();
    const split = { product: 0.7, tech: 0.3 };

    assert.equal(getCapacityShareLabel({ showProduct: true, showTech: false, capacitySplit: split }), 'Planning Product share 70%');
    assert.equal(getCapacityShareLabel({ showProduct: false, showTech: true, capacitySplit: split }), 'Planning Tech share 30%');
    assert.equal(getCapacityShareLabel({ showProduct: true, showTech: true, capacitySplit: split }), '');
    assert.equal(getCapacityShareLabel({ showProduct: false, showTech: false, capacitySplit: split }), '');
});

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createFakeAbortController() {
    return {
        signal: { aborted: false },
        abort() {
            this.signal.aborted = true;
        },
    };
}

function createCapacityReadModel(scopeSignature = '') {
    return {
        capacityState: {
            capacityByTeam: {},
            capacityTargetsByTeam: {},
            mutationEnabled: false,
            scopeSignature,
        },
        capacityLoading: false,
        capacityReadRevision: 0,
        capacityReadError: '',
        capacityDataStale: false,
    };
}

async function startDeferredCapacityRead({
    utils,
    ownershipRefs,
    modelRef,
    deferred,
    scopeSignature,
    sprintName = 'Sprint 1',
    teams = ['Alpha'],
    capacityEnabled = true,
    showPlanning = true,
}) {
    const ownership = utils.beginCapacityReadOwnership({
        ...ownershipRefs,
        scopeSignature,
        sprintName,
        teams,
        capacityEnabled,
        showPlanning,
        createAbortController: createFakeAbortController,
    });
    modelRef.current = utils.reduceCapacityReadLifecycle(modelRef.current, {
        type: ownership.shouldFetch ? 'start' : 'gate',
        scopeSignature,
    });
    const settled = ownership.shouldFetch
        ? deferred.promise.then(
            payload => {
                if (!ownership.isCurrent()) return;
                modelRef.current = utils.reduceCapacityReadLifecycle(modelRef.current, {
                    type: 'success',
                    scopeSignature,
                    payload,
                });
            },
            error => {
                if (error?.name === 'AbortError' || !ownership.isCurrent()) return;
                modelRef.current = utils.reduceCapacityReadLifecycle(modelRef.current, {
                    type: 'failure',
                    scopeSignature,
                });
            },
        )
        : Promise.resolve();
    return { ownership, settled };
}

test('capacity scope signatures distinguish normalized team arrays containing delimiters', async () => {
    const { beginCapacityReadOwnership, buildCapacityScopeSignature } = await loadUtils();

    const left = buildCapacityScopeSignature('Sprint 1', ['A', 'B|C']);
    const right = buildCapacityScopeSignature('Sprint 1', ['A|B', 'C']);

    assert.notEqual(left, right);
    assert.equal(left, buildCapacityScopeSignature('Sprint 1', [' b|c ', 'R&D A', 'A']));

    const ownershipRefs = {
        generationRef: { current: 0 },
        abortRef: { current: null },
        activeScopeRef: { current: left },
    };
    const first = beginCapacityReadOwnership({
        ...ownershipRefs,
        scopeSignature: left,
        sprintName: 'Sprint 1',
        teams: ['A', 'B|C'],
        capacityEnabled: true,
        showPlanning: true,
        createAbortController: createFakeAbortController,
    });
    ownershipRefs.activeScopeRef.current = right;
    const second = beginCapacityReadOwnership({
        ...ownershipRefs,
        scopeSignature: right,
        sprintName: 'Sprint 1',
        teams: ['A|B', 'C'],
        capacityEnabled: true,
        showPlanning: true,
        createAbortController: createFakeAbortController,
    });

    assert.equal(first.controller.signal.aborted, true);
    assert.equal(first.isCurrent(), false);
    assert.equal(second.isCurrent(), true);
    second.cleanup();
});

test('deferred capacity save updater rejects an old scope even when issue and team identities match', async () => {
    const { applyCapacitySaveResultForScope } = await loadUtils();
    const activeScopeRef = { current: 'scope-a' };
    const result = { scopeSignature: 'scope-a', issueKey: 'CAP-1', teamName: 'Alpha', capacity: 9 };
    const deferredUpdater = previous => applyCapacitySaveResultForScope(
        previous,
        result,
        activeScopeRef.current,
    );
    const newScopeStateWithMatchingIdentity = {
        capacityByTeam: { alpha: 5 },
        capacityTargetsByTeam: {
            alpha: { state: 'matched', issueKey: 'CAP-1', teamName: 'Alpha', capacity: 5 },
        },
        mutationEnabled: true,
        scopeSignature: 'scope-b',
    };

    activeScopeRef.current = 'scope-b';
    assert.equal(deferredUpdater(newScopeStateWithMatchingIdentity), newScopeStateWithMatchingIdentity);

    activeScopeRef.current = 'scope-a';
    const currentScopeState = { ...newScopeStateWithMatchingIdentity, scopeSignature: 'scope-a' };
    assert.equal(deferredUpdater(currentScopeState).capacityByTeam.alpha, 9);
});

test('capacity read ownership rejects stale completions after changed scope and unmount invalidation', async () => {
    const utils = await loadUtils();
    const ownershipRefs = {
        generationRef: { current: 0 },
        abortRef: { current: null },
        activeScopeRef: { current: 'scope-a' },
    };
    const modelRef = { current: createCapacityReadModel() };
    const firstDeferred = createDeferred();
    const first = await startDeferredCapacityRead({
        utils, ownershipRefs, modelRef, deferred: firstDeferred, scopeSignature: 'scope-a',
    });
    assert.equal(modelRef.current.capacityLoading, true);

    ownershipRefs.activeScopeRef.current = 'scope-b';
    const secondDeferred = createDeferred();
    const second = await startDeferredCapacityRead({
        utils, ownershipRefs, modelRef, deferred: secondDeferred, scopeSignature: 'scope-b',
    });
    assert.equal(first.ownership.controller.signal.aborted, true);
    firstDeferred.resolve({ enabled: true, capacities: { Alpha: 99 } });
    await first.settled;
    assert.equal(modelRef.current.capacityState.scopeSignature, 'scope-b');
    assert.equal(modelRef.current.capacityReadRevision, 0);

    second.ownership.cleanup();
    secondDeferred.resolve({ enabled: true, capacities: { Alpha: 7 } });
    await second.settled;
    assert.equal(modelRef.current.capacityReadRevision, 0);
    assert.equal(modelRef.current.capacityLoading, true);
});

test('Planning-off, capacity-disabled, and sprint-cleared gates abort and clear lifecycle state', async () => {
    const utils = await loadUtils();
    for (const gate of [
        { showPlanning: false, capacityEnabled: true, sprintName: 'Sprint 1', teams: ['Alpha'] },
        { showPlanning: true, capacityEnabled: false, sprintName: 'Sprint 1', teams: ['Alpha'] },
        { showPlanning: true, capacityEnabled: true, sprintName: '', teams: ['Alpha'] },
    ]) {
        const ownershipRefs = {
            generationRef: { current: 0 },
            abortRef: { current: null },
            activeScopeRef: { current: 'scope-a' },
        };
        const modelRef = { current: createCapacityReadModel('scope-a') };
        const pendingDeferred = createDeferred();
        modelRef.current = utils.reduceCapacityReadLifecycle(modelRef.current, {
            type: 'success', scopeSignature: 'scope-a',
            payload: { enabled: true, capacities: { Alpha: 5 }, mutationEnabled: true },
        });
        const pending = await startDeferredCapacityRead({
            utils, ownershipRefs, modelRef, deferred: pendingDeferred, scopeSignature: 'scope-a',
        });
        const gateDeferred = createDeferred();
        const gated = await startDeferredCapacityRead({
            utils, ownershipRefs, modelRef, deferred: gateDeferred, scopeSignature: 'scope-a', ...gate,
        });

        assert.equal(gated.ownership.shouldFetch, false);
        assert.equal(pending.ownership.controller.signal.aborted, true);
        assert.deepEqual(modelRef.current, {
            ...createCapacityReadModel('scope-a'),
            capacityReadRevision: 1,
        });
        pendingDeferred.resolve({ enabled: true, capacities: { Alpha: 99 } });
        await pending.settled;
        assert.deepEqual(modelRef.current, {
            ...createCapacityReadModel('scope-a'),
            capacityReadRevision: 1,
        });
    }
});

test('capacity failures preserve only same-scope numbers and retry success alone advances revision', async () => {
    const utils = await loadUtils();
    const scopeSignature = 'scope-a';
    let model = createCapacityReadModel(scopeSignature);
    model = utils.reduceCapacityReadLifecycle(model, {
        type: 'success', scopeSignature,
        payload: {
            enabled: true,
            capacities: { Alpha: 0, Beta: 5 },
            entries: [{ teamName: 'Beta', issueKey: 'CAP-2', capacity: 5 }],
            mutationEnabled: true,
        },
    });
    assert.equal(model.capacityReadRevision, 1);

    model = {
        ...model,
        capacityState: utils.applyCapacitySaveResultForScope(model.capacityState, {
            scopeSignature,
            issueKey: 'CAP-2',
            teamName: 'Beta',
            capacity: 7,
        }, scopeSignature),
    };
    assert.equal(model.capacityState.capacityByTeam.beta, 7);
    assert.equal(model.capacityReadRevision, 1);

    model = utils.reduceCapacityReadLifecycle(model, { type: 'start', scopeSignature });
    model = utils.reduceCapacityReadLifecycle(model, { type: 'failure', scopeSignature });
    assert.deepEqual(model.capacityState.capacityByTeam, { alpha: 0, beta: 7 });
    assert.deepEqual(model.capacityState.capacityTargetsByTeam, {});
    assert.equal(model.capacityState.mutationEnabled, false);
    assert.equal(model.capacityDataStale, true);
    assert.equal(model.capacityReadError, 'Capacity could not be refreshed.');
    assert.equal(model.capacityReadRevision, 1);

    model = utils.reduceCapacityReadLifecycle(model, { type: 'start', scopeSignature });
    assert.equal(model.capacityLoading, true);
    model = utils.reduceCapacityReadLifecycle(model, {
        type: 'success', scopeSignature,
        payload: { enabled: true, capacities: { Alpha: 3 }, mutationEnabled: true },
    });
    assert.equal(model.capacityReadRevision, 2);
    assert.equal(model.capacityReadError, '');
    assert.equal(model.capacityDataStale, false);
    assert.equal(model.capacityLoading, false);

    const newScopeFailure = utils.reduceCapacityReadLifecycle(model, {
        type: 'failure', scopeSignature: 'scope-b',
    });
    assert.deepEqual(newScopeFailure.capacityState.capacityByTeam, {});
    assert.equal(newScopeFailure.capacityDataStale, false);
    assert.equal(newScopeFailure.capacityReadRevision, 2);
});
