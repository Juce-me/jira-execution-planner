const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useEngSprintData.js');
const hookSource = fs.readFileSync(sourcePath, 'utf8');

function loadUseEngSprintData(fetchEngTasks, refreshAuthSession = async () => ({ ok: false, status: 401, json: async () => ({}) }), overrides = {}) {
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace(/^import\s+[^;]+;\s*$/gm, '')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');

    const dependencies = {
        requestBacklogEpics: async () => ({ epics: [] }),
        fetchEngTasks,
        isAuthenticationRequiredError: (error) => error?.name === 'AuthenticationRequiredError',
        refreshAuthSession,
        PRIORITY_ORDER: [],
        filterEpicsByTaskEpicKeys: () => ({}),
        filterEpicsInScopeForTeamSet: (epics) => epics,
        filterTasksForTeamSet: (tasks) => tasks,
        sortTasksByPriority: (tasks) => tasks,
        ...overrides,
    };

    return new Function(
        ...Object.keys(dependencies),
        `${source}; return { useEngSprintData };`
    )(...Object.values(dependencies));
}

function createHarness(fetchEngTasks, {
    refreshAuthSession,
    setters = {},
    sprintLoadRef = { current: {} },
    lastLoadedSprintRef = { current: '' },
    loadedProductTasks = [],
    loadedTechTasks = [],
    performanceDebugEnabled = false,
    measurementDependencies = {},
    strictBoardActive = false,
} = {}) {
    const { useEngSprintData } = loadUseEngSprintData(fetchEngTasks, refreshAuthSession, measurementDependencies);
    const errors = [];
    const controller = { signal: { aborted: false } };
    const noop = () => {};

    const api = useEngSprintData({
        backendUrl: 'http://localhost:5050',
        selectedSprint: '2026Q1',
        activeGroupId: performanceDebugEnabled ? 'sample-group' : '',
        activeGroupTeamIds: performanceDebugEnabled ? ['sample-team'] : [],
        performanceDebugEnabled,
        strictBoardActive,
        activeGroupTeamSet: new Set(),
        pageLoadRefreshRef: { current: false },
        sprintLoadRef,
        lastLoadedSprintRef,
        registerSprintFetch: () => controller,
        cleanupSprintFetch: noop,
        isFutureSprintSelected: false,
        loadedProductTasks,
        loadedTechTasks,
        setLoading: noop,
        setError: (message) => errors.push(message),
        setEpicDetails: noop,
        setProductTasks: setters.setProductTasks || noop,
        setTechTasks: setters.setTechTasks || noop,
        setLoadedProductTasks: setters.setLoadedProductTasks || noop,
        setLoadedTechTasks: setters.setLoadedTechTasks || noop,
        setTasksFetched: setters.setTasksFetched || noop,
        setTechLoaded: setters.setTechLoaded || noop,
        setProductTasksLoading: noop,
        setTechTasksLoading: noop,
        setProductEpicsInScope: noop,
        setTechEpicsInScope: noop,
        setReadyToCloseProductTasks: setters.setReadyToCloseProductTasks || noop,
        setReadyToCloseTechTasks: setters.setReadyToCloseTechTasks || noop,
        setReadyToCloseProductEpicsInScope: setters.setReadyToCloseProductEpicsInScope || noop,
        setReadyToCloseTechEpicsInScope: setters.setReadyToCloseTechEpicsInScope || noop,
    });

    return { api, errors };
}

test('strict Board retires every legacy sprint loader without issuing transport', async () => {
    const calls = [];
    const { api } = createHarness(async () => {
        calls.push('tasks');
        throw new Error('legacy task transport must stay retired');
    }, {
        strictBoardActive: true,
        measurementDependencies: {
            requestBacklogEpics: async () => {
                calls.push('backlog');
                return { epics: [] };
            },
            createGroupLoadMeasurement: () => ({
                enabled: false, contentReady() {}, dependencies() {}, finish() {}, cancel() {},
            }),
            laneMetrics: () => ({}),
            recordPerformanceLoad: async () => {},
        },
    });

    const group = api.loadGroupTasks();
    await Promise.all([group.product, group.tech]);
    await api.fetchTasks('product');
    await api.fetchBacklogEpics('product');
    await api.loadAlertEpics();
    await api.loadReadyToCloseProductTasks();
    await api.loadReadyToCloseTechTasks();

    assert.deepEqual(calls, []);
});

test('ENG typed auth errors preserve feature state without redirect or local error', async () => {
    const redirects = [];
    const previousWindow = global.window;
    const previousConsoleLog = console.log;
    const previousConsoleError = console.error;
    global.window = {
        location: {
            assign: (url) => redirects.push(url),
        },
    };
    console.log = () => {};
    console.error = () => {};

    try {
        const authError = new Error('Authentication is required to continue.');
        authError.name = 'AuthenticationRequiredError';
        const { api, errors } = createHarness(async () => { throw authError; });

        await api.fetchTasks('product');

        assert.deepEqual(redirects, []);
        assert.deepEqual(errors, ['']);
    } finally {
        console.log = previousConsoleLog;
        console.error = previousConsoleError;
        if (previousWindow === undefined) {
            delete global.window;
        } else {
            global.window = previousWindow;
        }
    }
});

test('ENG task missing_project_access errors show project access recovery text', async () => {
    const previousConsoleLog = console.log;
    const previousConsoleError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
        const { api, errors } = createHarness(async () => ({
            ok: false,
            status: 403,
            json: async () => ({
                error: 'missing_project_access',
                projectType: 'product',
                projectAccessStatus: 'unknown',
                recoveryUrl: '/auth/missing-project-access',
            }),
        }));

        await api.fetchTasks('product');

        assert.match(errors.at(-1), /Jira project access/);
        assert.doesNotMatch(errors.at(-1), /Python server/);
    } finally {
        console.log = previousConsoleLog;
        console.error = previousConsoleError;
    }
});

test('ENG task 401 responses are not retried by a feature hook', async () => {
    const previousConsoleLog = console.log;
    const previousConsoleError = console.error;
    console.log = () => {};
    console.error = () => {};
    const calls = [];
    const refreshCalls = [];

    try {
        const { api, errors } = createHarness(async () => {
            calls.push('tasks');
            if (calls.length === 1) {
                return {
                    ok: false,
                    status: 401,
                    json: async () => ({
                        error: 'auth_connection_stale',
                        message: 'Your Jira connection changed. Reconnect to continue.',
                        recoveryUrl: '/auth/reconnect',
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ issues: [{ key: 'PROD-1', fields: { priority: { name: 'Major' } } }], epics: {}, epicsInScope: [] }),
            };
        }, {
            refreshAuthSession: async () => {
                refreshCalls.push('refresh');
                return { ok: true, status: 200, json: async () => ({ authenticated: true }) };
            },
        });

        const outcome = await api.fetchTasks('product');

        assert.equal(refreshCalls.length, 0);
        assert.equal(calls.length, 1);
        assert.equal(outcome, 'non_auth_failure');
    } finally {
        console.log = previousConsoleLog;
        console.error = previousConsoleError;
    }
});

test('ENG task stale auth errors show reconnect text after refresh cannot recover', async () => {
    const previousConsoleLog = console.log;
    const previousConsoleError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
        const { api, errors } = createHarness(async () => ({
            ok: false,
            status: 401,
            json: async () => ({
                error: 'auth_connection_stale',
                message: 'Your Jira connection changed. Reconnect to continue.',
                recoveryUrl: '/auth/reconnect',
            }),
        }));

        await api.fetchTasks('product');

        assert.match(errors.at(-1), /Jira connection changed/);
        assert.match(errors.at(-1), /reconnect/);
        assert.doesNotMatch(errors.at(-1), /Python server/);
    } finally {
        console.log = previousConsoleLog;
        console.error = previousConsoleError;
    }
});

test('ENG loaders use an auth sentinel before replacing task and sprint state', () => {
    assert.ok(hookSource.includes("AUTH_REQUIRED: 'auth_required'"));
    const authGuard = 'if (data === AUTHENTICATION_REQUIRED_RESULT) return ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED;';
    assert.ok(hookSource.includes(authGuard));
    assert.ok(hookSource.indexOf(authGuard) < hookSource.indexOf('setProductTasks(reconciled);'));
    assert.ok(hookSource.lastIndexOf(authGuard) < hookSource.indexOf('setTechTasks(reconciled);'));
});

test('ENG product loader preserves task and sprint markers on typed auth', async () => {
    const authError = Object.assign(new Error('auth'), { name: 'AuthenticationRequiredError' });
    const mutations = [];
    const sprintLoadRef = { current: { sprintId: 'old', product: true, tech: true } };
    const lastLoadedSprintRef = { current: 'old' };
    const { api } = createHarness(async () => { throw authError; }, {
        sprintLoadRef,
        lastLoadedSprintRef,
        setters: {
            setProductTasks: value => mutations.push(['product', value]),
            setLoadedProductTasks: value => mutations.push(['loaded', value]),
            setTasksFetched: value => mutations.push(['fetched', value]),
        },
    });
    const outcome = await api.loadProductTasks();
    assert.equal(outcome, 'auth_required');
    assert.deepEqual(mutations, []);
    assert.deepEqual(sprintLoadRef.current, { sprintId: 'old', product: true, tech: true });
    assert.equal(lastLoadedSprintRef.current, 'old');
});

test('ENG product loader reports applied success for a legitimate empty result', async () => {
    const { api } = createHarness(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ issues: [], epics: {}, epicsInScope: [] }),
    }));

    assert.equal(await api.loadProductTasks(), 'applied');
});

test('ENG product loader reports a non-auth failure', async () => {
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
        const { api } = createHarness(async () => {
            throw new Error('offline');
        });

        assert.equal(await api.loadProductTasks(), 'non_auth_failure');
    } finally {
        console.error = previousConsoleError;
    }
});

test('ENG product loader reports a typed auth interruption', async () => {
    const authError = Object.assign(new Error('auth'), { name: 'AuthenticationRequiredError' });
    const { api } = createHarness(async () => {
        throw authError;
    });

    assert.equal(await api.loadProductTasks(), 'auth_required');
});

test('ENG product loader reports a stale ignored result', async () => {
    const { api } = createHarness(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ issues: [{ key: 'PROD-1' }], epics: {}, epicsInScope: [] }),
    }));

    assert.equal(await api.loadProductTasks({ shouldApplyResult: () => false }), 'ignored');
});

for (const project of ['product', 'tech']) {
    test(`ENG ready-to-close ${project} loader preserves tasks on typed auth`, async () => {
        const authError = Object.assign(new Error('auth'), { name: 'AuthenticationRequiredError' });
        const mutations = [];
        const task = { key: `${project.toUpperCase()}-1`, fields: { epicKey: `${project.toUpperCase()}-EPIC` } };
        const setters = project === 'product'
            ? { setReadyToCloseProductTasks: value => mutations.push(value) }
            : { setReadyToCloseTechTasks: value => mutations.push(value) };
        const { api } = createHarness(async () => { throw authError; }, {
            loadedProductTasks: project === 'product' ? [task] : [],
            loadedTechTasks: project === 'tech' ? [task] : [],
            setters,
        });

        if (project === 'product') {
            await api.loadReadyToCloseProductTasks();
        } else {
            await api.loadReadyToCloseTechTasks();
        }

        assert.deepEqual(mutations, []);
    });
}

test('debug group hook measures both ordinary lanes once and waits for dependencies and paint', async () => {
    const { createGroupLoadMeasurement, laneMetrics } = await import('../frontend/src/eng/loadPerformance.js');
    const observations = [];
    const pending = {};
    const calls = [];
    const paints = [];
    const { api } = createHarness((_url, options) => {
        calls.push(options);
        if (options.purpose === 'alerts') return Promise.resolve(new Response(JSON.stringify({ issues: [] })));
        return new Promise(resolve => { pending[options.project] = resolve; });
    }, {
        performanceDebugEnabled: true,
        measurementDependencies: {
            laneMetrics,
            createGroupLoadMeasurement: options => createGroupLoadMeasurement({ ...options,
                afterPaint: () => new Promise(resolve => { paints.push(resolve); }),
            }),
            recordPerformanceLoad: async (_url, sample) => observations.push(sample),
        },
    });
    const load = api.loadGroupTasks({ waitForDependencies: true });
    assert.equal(load.primaryReady, false, 'the old dashboard render must not begin dependencies');
    assert.deepEqual(calls.map(call => [call.project, call.debugTimings]), [['product', true], ['tech', true]]);
    for (const project of ['product', 'tech']) pending[project](new Response(JSON.stringify({
        issues: [{ key: `${project}-1`, fields: { issuetype: { name: 'Story' } } }],
        epics: {}, epicsInScope: [], loadMetrics: { completeness: 'unknown', cacheState: 'miss' },
    })));
    assert.deepEqual(await Promise.all([load.product, load.tech]), ['applied', 'applied']);
    assert.equal(load.primaryReady, true);
    assert.equal(observations.length, 0);
    assert.equal(paints.length, 1, 'first lane paint is observed independently');
    paints.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(observations.length, 0, 'first lane paint cannot finish the group');
    load.dependenciesFinished('applied', 125);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(observations.length, 0, 'render boundary must also complete');
    assert.equal(paints.length, 1, 'group paint is scheduled after dependencies');
    paints.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(observations.length, 1);
    assert.equal(observations[0].dependencyDurationMs, 125);
    assert.deepEqual(observations[0].lanes.map(lane => [lane.project, lane.issueCount, lane.storyCount]), [['product', 1, 1], ['tech', 1, 1]]);
    await api.loadAlertEpics();
    assert.deepEqual(calls.slice(2).map(call => [call.purpose, call.debugTimings]), [['alerts', false], ['alerts', false]]);
    assert.equal(observations.length, 1, 'lazy alert loads must not emit group observations');
    load.cancel();
    assert.equal(observations.length, 1, 'completed measurements are terminal');
});
