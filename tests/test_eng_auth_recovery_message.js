const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useEngSprintData.js');

function loadUseEngSprintData(fetchEngTasks) {
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace(/import\s+\{[\s\S]*?\}\s+from\s+'..\/api\/engApi\.js';\n/, '')
        .replace(/import\s+\{[\s\S]*?\}\s+from\s+'.\/engTaskUtils\.js';\n/, '')
        .replaceAll('export function ', 'function ');

    const dependencies = {
        requestBacklogEpics: async () => ({ epics: [] }),
        fetchEngTasks,
        PRIORITY_ORDER: [],
        filterEpicsByTaskEpicKeys: () => ({}),
        filterEpicsInScopeForTeamSet: (epics) => epics,
        filterTasksForTeamSet: (tasks) => tasks,
        sortTasksByPriority: (tasks) => tasks,
    };

    return new Function(
        ...Object.keys(dependencies),
        `${source}; return { useEngSprintData };`
    )(...Object.values(dependencies));
}

function createHarness(fetchEngTasks) {
    const { useEngSprintData } = loadUseEngSprintData(fetchEngTasks);
    const errors = [];
    const controller = { signal: { aborted: false } };
    const noop = () => {};

    const api = useEngSprintData({
        backendUrl: 'http://localhost:5050',
        selectedSprint: '2026Q1',
        activeGroupId: '',
        activeGroupTeamIds: [],
        activeGroupTeamSet: new Set(),
        pageLoadRefreshRef: { current: false },
        sprintLoadRef: { current: {} },
        lastLoadedSprintRef: { current: '' },
        registerSprintFetch: () => controller,
        cleanupSprintFetch: noop,
        isFutureSprintSelected: false,
        loadedProductTasks: [],
        loadedTechTasks: [],
        setLoading: noop,
        setError: (message) => errors.push(message),
        setEpicDetails: noop,
        setProductTasks: noop,
        setTechTasks: noop,
        setLoadedProductTasks: noop,
        setLoadedTechTasks: noop,
        setTasksFetched: noop,
        setTechLoaded: noop,
        setProductTasksLoading: noop,
        setTechTasksLoading: noop,
        setProductEpicsInScope: noop,
        setTechEpicsInScope: noop,
        setReadyToCloseProductTasks: noop,
        setReadyToCloseTechTasks: noop,
        setReadyToCloseProductEpicsInScope: noop,
        setReadyToCloseTechEpicsInScope: noop,
    });

    return { api, errors };
}

test('ENG task auth_required errors redirect to the login recovery page', async () => {
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
        const { api, errors } = createHarness(async () => ({
            ok: false,
            status: 401,
            json: async () => ({
                error: 'auth_required',
                loginUrl: '/login?reason=session_expired',
            }),
        }));

        await api.fetchTasks('product');

        assert.deepEqual(redirects, ['/login?reason=session_expired']);
        assert.match(errors.at(-1), /Sign in with Atlassian/);
        assert.doesNotMatch(errors.at(-1), /Python server/);
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
