const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendSrcPath = path.join(__dirname, '..', 'frontend', 'src');
const apiPathSegment = `${path.sep}api${path.sep}`;
// Raw API endpoint literals belong under frontend/src/api.
const allowedTransitionalWrappers = new Set();

function listSourceFiles(root) {
    if (!fs.existsSync(root)) return [];
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) return listSourceFiles(fullPath);
        return /\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
    });
}

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function relativeFile(filePath) {
    return path.relative(path.join(__dirname, '..'), filePath);
}

function loadHttpHelpers() {
    const helperPath = path.join(frontendSrcPath, 'api', 'http.js');
    assert.ok(fs.existsSync(helperPath), 'Expected frontend/src/api/http.js to exist');
    const source = readSource(helperPath)
        .replace(/import\s+\{[^}]+\}\s+from\s+'\.\.\/analytics\/analytics\.js';\n?/, '')
        .replaceAll('export async function ', 'async function ')
        .replaceAll('export function ', 'function ');
    return new Function('trackApiResult', `${source}; return { json, getJson, postJson, trackedFetch };`)(() => {});
}

function loadApiModule(fileName, exportNames, dependencies = {}) {
    const modulePath = path.join(frontendSrcPath, 'api', fileName);
    assert.ok(fs.existsSync(modulePath), `Expected frontend/src/api/${fileName} to exist`);
    const source = readSource(modulePath)
        .replace(/import\s+\{[^}]+\}\s+from\s+'\.\/http\.js';\n?/, '')
        .replaceAll('export async function ', 'async function ')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    const mergedDependencies = {
        trackedFetch: (_apiSurface, url, options) => fetch(url, options),
        ...dependencies,
    };
    const names = Object.keys(mergedDependencies);
    const values = Object.values(mergedDependencies);
    return new Function(...names, `${source}; return { ${exportNames.join(', ')} };`)(...values);
}

function jsonResponse(payload = {}) {
    return {
        ok: true,
        status: 200,
        json: async () => payload,
    };
}

async function withMockFetch(callback, responseFactory = () => jsonResponse({ ok: true })) {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return responseFactory(url, options, calls.length - 1);
    };

    try {
        await callback(calls);
    } finally {
        global.fetch = originalFetch;
    }
}

function assertJsonHeader(options) {
    const headers = new Headers(options.headers || {});
    assert.equal(headers.get('Content-Type'), 'application/json');
}

test('backend URL resolver uses same origin for hosted HTTP pages', () => {
    const { resolveBackendUrl } = loadApiModule('backendUrl.js', ['resolveBackendUrl']);

    assert.equal(resolveBackendUrl({
        BACKEND_URL: '',
        location: { protocol: 'https:', origin: 'https://planner.example.test' },
    }), 'https://planner.example.test');

    assert.equal(resolveBackendUrl({
        BACKEND_URL: '',
        location: { protocol: 'http:', origin: 'http://localhost:5051' },
    }), 'http://localhost:5051');
});

test('backend URL resolver preserves explicit override and file fallback', () => {
    const { resolveBackendUrl } = loadApiModule('backendUrl.js', ['resolveBackendUrl']);

    assert.equal(resolveBackendUrl({
        BACKEND_URL: 'https://api.example.test',
        location: { protocol: 'https:', origin: 'https://planner.example.test' },
    }), 'https://api.example.test');

    assert.equal(resolveBackendUrl({
        BACKEND_URL: '',
        location: { protocol: 'file:', origin: 'null' },
    }), 'http://localhost:5050');
});

test('dashboard no longer hardcodes 5050 for HTTP-served pages', () => {
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));
    assert.ok(!dashboardSource.includes('`${window.location.protocol}//${window.location.hostname}:${DEFAULT_BACKEND_PORT}`'));
});

test('EPM frontend modules do not call ENG, planning, or scenario endpoints', () => {
    const epmFiles = listSourceFiles(path.join(frontendSrcPath, 'epm'));
    assert.ok(epmFiles.length > 0, 'Expected EPM frontend modules to exist');

    const forbiddenPatterns = [
        /\/api\/tasks-with-team-name\b/,
        /\/api\/backlog-epics\b/,
        /\/api\/capacity\b/,
        /\/api\/capacity\/config\b/,
        /\/api\/dependencies\b/,
        /\/api\/missing-info\b/,
        /\/api\/planned-capacity\b/,
        /\/api\/scenario\b/,
        /\/api\/scenario\//,
    ];

    const violations = epmFiles.flatMap((filePath) => {
        const source = readSource(filePath);
        return forbiddenPatterns
            .filter((pattern) => pattern.test(source))
            .map((pattern) => `${relativeFile(filePath)} matched ${pattern}`);
    });

    assert.deepEqual(violations, []);
});

test('ENG frontend modules do not call EPM endpoints after ENG extraction exists', () => {
    const engFiles = listSourceFiles(path.join(frontendSrcPath, 'eng'));
    const violations = engFiles
        .filter((filePath) => /\/api\/epm(?:\/|\b)/.test(readSource(filePath)))
        .map(relativeFile);

    assert.deepEqual(violations, []);
});

test('frontend API endpoint literals live in api modules or approved transitional wrappers', () => {
    const endpointLiteralFiles = listSourceFiles(frontendSrcPath)
        .filter((filePath) => /(^|[^.])\/api\//.test(readSource(filePath)));

    const violations = endpointLiteralFiles
        .filter((filePath) => !filePath.includes(apiPathSegment))
        .filter((filePath) => !allowedTransitionalWrappers.has(filePath))
        .map(relativeFile);

    assert.deepEqual(violations, []);
});

test('ENG startup uses cached task data unless the user explicitly refreshes', () => {
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));

    assert.ok(
        dashboardSource.includes('const pageLoadRefreshRef = useRef(false);'),
        'Initial ENG page load should not force refresh=true and bypass the server cache',
    );
    assert.ok(
        !dashboardSource.includes('const pageLoadRefreshRef = useRef(true);'),
        'Only explicit refresh actions should bypass the server cache',
    );
});

test('shared API HTTP helpers preserve current JSON error behavior', async () => {
    const { json } = loadHttpHelpers();

    await assert.rejects(
        () => json({ ok: false, status: 503 }, 'Test payload'),
        /Test payload error 503/
    );

    const payload = await json({
        ok: true,
        json: async () => ({ ok: true }),
    }, 'Test payload');
    assert.deepEqual(payload, { ok: true });
});

test('shared API HTTP helpers preserve caller options and headers', async () => {
    const { getJson, postJson } = loadHttpHelpers();
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return {
            ok: true,
            json: async () => ({ ok: true }),
        };
    };

    try {
        const getOptions = { cache: 'no-cache' };
        await getJson('/api/example', 'GET example', getOptions);
        assert.equal(calls[0].url, '/api/example');
        assert.deepEqual(calls[0].options, getOptions);

        await postJson('/api/example', { id: 1 }, 'POST example', {
            cache: 'no-cache',
            headers: new Headers([['X-Trace-Id', 'trace-1']]),
        });

        assert.equal(calls[1].url, '/api/example');
        assert.equal(calls[1].options.cache, 'no-cache');
        assert.equal(calls[1].options.method, 'POST');
        assert.equal(calls[1].options.body, JSON.stringify({ id: 1 }));
        assert.equal(calls[1].options.headers.get('X-Trace-Id'), 'trace-1');
        assert.equal(calls[1].options.headers.get('Content-Type'), 'application/json');
    } finally {
        global.fetch = originalFetch;
    }
});

test('EPM API module owns endpoint construction without EPM compatibility wrappers', () => {
    const epmApiPath = path.join(frontendSrcPath, 'api', 'epmApi.js');
    const epmFetchPath = path.join(frontendSrcPath, 'epm', 'epmFetch.js');
    assert.ok(fs.existsSync(epmApiPath), 'Expected frontend/src/api/epmApi.js to exist');
    assert.ok(!fs.existsSync(epmFetchPath), 'Did not expect frontend/src/epm/epmFetch.js compatibility wrapper');

    const epmApiSource = readSource(epmApiPath);

    assert.ok(epmApiSource.includes("from './http.js'"), 'Expected EPM API module to use shared HTTP helpers');
    assert.ok(epmApiSource.includes('/api/epm/config'), 'Expected EPM config URL construction in epmApi.js');
    assert.ok(epmApiSource.includes('/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}'), 'Expected project rollup URL construction in epmApi.js');
    assert.ok(epmApiSource.includes('/api/epm/projects/rollup/all?${params.toString()}'), 'Expected aggregate rollup URL construction in epmApi.js');
    assert.ok(epmApiSource.includes("fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {})"), 'Expected configuration project wrapper in epmApi.js');
});

test('EPM configuration project refresh sends token-bound CSRF header', async () => {
    const { getJson, postJson } = loadHttpHelpers();
    const epmApi = loadApiModule('epmApi.js', [
        'fetchEpmConfigurationProjects',
    ], { getJson, postJson });

    await withMockFetch(async (calls) => {
        await epmApi.fetchEpmConfigurationProjects(
            'http://backend',
            { scope: { rootGoalKey: 'CRITE-1', subGoalKeys: ['CRITE-2'] } },
            { forceRefresh: true },
        );

        assert.equal(calls[0].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[0].options.cache, 'no-cache');
        assert.equal(calls[1].url, 'http://backend/api/epm/projects/configuration?refresh=true');
        assert.equal(calls[1].options.method, 'POST');
        assert.equal(calls[1].options.body, JSON.stringify({
            scope: { rootGoalKey: 'CRITE-1', subGoalKeys: ['CRITE-2'] },
        }));
        assert.equal(new Headers(calls[1].options.headers).get('X-CSRF-Token'), 'csrf-token');
        assertJsonHeader(calls[1].options);
    }, (url) => {
        if (String(url).endsWith('/api/auth/csrf')) {
            return jsonResponse({ csrfToken: 'csrf-token' });
        }
        return jsonResponse({ projects: [] });
    });
});

test('EPM config save wrapper sends token-bound CSRF header', async () => {
    const { getJson, postJson } = loadHttpHelpers();
    const epmApi = loadApiModule('epmApi.js', [
        'saveEpmConfig',
    ], { getJson, postJson });

    await withMockFetch(async (calls) => {
        const payload = await epmApi.saveEpmConfig('http://backend', {
            scope: { rootGoalKey: 'CRITE-1' },
        });

        assert.deepEqual(payload, { ok: true });
        assert.equal(calls[0].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[1].url, 'http://backend/api/epm/config');
        assert.equal(calls[1].options.method, 'POST');
        assert.equal(calls[1].options.body, JSON.stringify({
            scope: { rootGoalKey: 'CRITE-1' },
        }));
        assert.equal(new Headers(calls[1].options.headers).get('X-CSRF-Token'), 'csrf-token');
        assertJsonHeader(calls[1].options);
    }, (url) => {
        if (String(url).endsWith('/api/auth/csrf')) {
            return jsonResponse({ csrfToken: 'csrf-token' });
        }
        return jsonResponse({ ok: true });
    });
});

test('ENG API module owns ENG task, backlog, and dependency endpoint construction', () => {
    const engApiPath = path.join(frontendSrcPath, 'api', 'engApi.js');
    assert.ok(fs.existsSync(engApiPath), 'Expected frontend/src/api/engApi.js to exist');

    const engApiSource = readSource(engApiPath);
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));

    assert.ok(engApiSource.includes("from './http.js'"), 'Expected ENG API module to use shared HTTP helpers');
    assert.ok(engApiSource.includes('/api/tasks-with-team-name?${params.toString()}'), 'Expected task URL construction in engApi.js');
    assert.ok(engApiSource.includes('/api/backlog-epics?${params.toString()}'), 'Expected backlog epic URL construction in engApi.js');
    assert.ok(engApiSource.includes('/api/dependencies'), 'Expected dependency URL construction in engApi.js');
    assert.ok(dashboardSource.includes("from './api/engApi.js'"), 'Expected dashboard to import ENG API wrappers');
});

test('ENG API wrapper builds story subtask request with tracked analytics surface', async () => {
    const calls = [];
    const engApi = loadApiModule('engApi.js', [
        'fetchStorySubtasks',
    ], {
        trackedFetch: async (apiSurface, url, options, analyticsParams) => {
            calls.push({ apiSurface, url, options, analyticsParams });
            return jsonResponse({ subtasks: [] });
        },
    });

    await engApi.fetchStorySubtasks('http://backend', {
        parentKey: 'PROD-1',
        sprint: '42',
        refresh: true,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].apiSurface, 'eng_subtasks');
    assert.deepEqual(calls[0].analyticsParams, { featureName: 'eng' });
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/api/issues/subtasks');
    assert.equal(url.searchParams.get('parentKey'), 'PROD-1');
    assert.equal(url.searchParams.get('sprint'), '42');
    assert.equal(url.searchParams.get('refresh'), 'true');
    assert.ok(url.searchParams.get('t'));
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.cache, 'no-cache');
    assertJsonHeader(calls[0].options);
});

test('settings config API module owns config request endpoint construction', () => {
    const configApiPath = path.join(frontendSrcPath, 'api', 'configApi.js');
    assert.ok(fs.existsSync(configApiPath), 'Expected frontend/src/api/configApi.js to exist');

    const configApiSource = readSource(configApiPath);
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));

    assert.ok(configApiSource.includes("from './http.js'"), 'Expected config API module to use shared HTTP helpers');
    assert.ok(configApiSource.includes('/api/config'), 'Expected app config URL construction in configApi.js');
    assert.ok(configApiSource.includes('/api/groups-config'), 'Expected groups config URL construction in configApi.js');
    assert.ok(configApiSource.includes('/api/groups-preferences'), 'Expected group preferences URL construction in configApi.js');
    assert.ok(configApiSource.includes('/api/projects/selected'), 'Expected selected projects URL construction in configApi.js');
    assert.ok(configApiSource.includes('/api/board-config'), 'Expected board config URL construction in configApi.js');
    assert.ok(configApiSource.includes('/api/capacity/config'), 'Expected capacity config URL construction in configApi.js');
    assert.ok(configApiSource.includes('/api/stats/priority-weights-config'), 'Expected priority weights URL construction in configApi.js');
    assert.ok(dashboardSource.includes("from './api/configApi.js'"), 'Expected dashboard to import config API wrappers');
});

test('Jira catalog API module owns Jira catalog request endpoint construction', () => {
    const jiraCatalogApiPath = path.join(frontendSrcPath, 'api', 'jiraCatalogApi.js');
    assert.ok(fs.existsSync(jiraCatalogApiPath), 'Expected frontend/src/api/jiraCatalogApi.js to exist');

    const jiraCatalogApiSource = readSource(jiraCatalogApiPath);
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));

    assert.ok(jiraCatalogApiSource.includes("from './http.js'"), 'Expected Jira catalog API module to use shared HTTP helpers');
    assert.ok(jiraCatalogApiSource.includes('/api/projects'), 'Expected project catalog URL construction in jiraCatalogApi.js');
    assert.ok(jiraCatalogApiSource.includes('/api/boards'), 'Expected board catalog URL construction in jiraCatalogApi.js');
    assert.ok(jiraCatalogApiSource.includes('/api/components'), 'Expected component search URL construction in jiraCatalogApi.js');
    assert.ok(jiraCatalogApiSource.includes('/api/epics/search'), 'Expected epic search URL construction in jiraCatalogApi.js');
    assert.ok(jiraCatalogApiSource.includes('/api/fields'), 'Expected fields URL construction in jiraCatalogApi.js');
    assert.ok(jiraCatalogApiSource.includes('/api/jira/labels'), 'Expected Jira labels URL construction in jiraCatalogApi.js');
    assert.ok(jiraCatalogApiSource.includes('/api/teams'), 'Expected teams catalog URL construction in jiraCatalogApi.js');
    assert.ok(jiraCatalogApiSource.includes('/api/team-catalog'), 'Expected team catalog URL construction in jiraCatalogApi.js');
    assert.ok(dashboardSource.includes("from './api/jiraCatalogApi.js'"), 'Expected dashboard to import Jira catalog API wrappers');
});

test('auth API module owns current-user connection endpoint construction', () => {
    const authApiPath = path.join(frontendSrcPath, 'api', 'authApi.js');
    const connectionsSettingsPath = path.join(frontendSrcPath, 'settings', 'UserConnectionsSettings.jsx');
    assert.ok(fs.existsSync(authApiPath), 'Expected frontend/src/api/authApi.js to exist');
    assert.ok(fs.existsSync(connectionsSettingsPath), 'Expected frontend/src/settings/UserConnectionsSettings.jsx to exist');

    const authApiSource = readSource(authApiPath);
    const connectionsSettingsSource = readSource(connectionsSettingsPath);
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));

    assert.ok(authApiSource.includes("from './http.js'"), 'Expected auth API module to use shared HTTP helpers');
    assert.ok(authApiSource.includes('/api/me/connections/home-token'), 'Expected Home token URL construction in authApi.js');
    assert.ok(authApiSource.includes('/api/auth/csrf'), 'Expected CSRF token URL construction in authApi.js');
    assert.ok(connectionsSettingsSource.includes("from '../api/authApi.js'"), 'Expected Connections settings to import auth API wrappers');
    assert.ok(dashboardSource.includes("from './settings/UserConnectionsSettings.jsx'"), 'Expected dashboard to import Connections settings');
    assert.ok(!dashboardSource.includes('/api/me/connections/home-token'), 'dashboard.jsx must not own Home token endpoint literals');
});

test('ENG API wrappers preserve task, backlog, dependency, and alert request details', async () => {
    const { getJson } = loadHttpHelpers();
    const engApi = loadApiModule('engApi.js', [
        'fetchMissingPlanningInfo',
        'fetchEngTasks',
        'fetchBacklogEpics',
        'fetchDependencies',
        'fetchExcludedCapacityStatsSource',
    ], { getJson });
    const signal = new AbortController().signal;

    await withMockFetch(async (calls) => {
        await engApi.fetchEngTasks('http://backend', {
            project: 'product',
            sprint: '123',
            sprintName: '2026Q3',
            groupId: 'group-a',
            teamIds: ['team-1', 'team-2'],
            teamLabels: ['team_alpha_label', 'team_beta_label'],
            refresh: true,
            purpose: 'alerts',
            epicKeys: ['EPM-1', 'EPM-1', 'EPM-2', ''],
            signal,
        });
        await engApi.fetchDependencies('http://backend', ['EPM-1', 'EPM-2'], { signal });
        await engApi.fetchMissingPlanningInfo('http://backend', {
            sprintId: 123,
            teamIds: ['team-1'],
            components: ['Comp A'],
            signal,
        });
        const backlogPayload = await engApi.fetchBacklogEpics('http://backend', {
            project: 'tech',
            teamIds: ['team-1'],
        });
        await engApi.fetchExcludedCapacityStatsSource('http://backend', {
            sprintIds: ['101', '102'],
            teamIds: ['team-1'],
            signal,
        });

        const taskUrl = new URL(calls[0].url);
        assert.equal(taskUrl.pathname, '/api/tasks-with-team-name');
        assert.equal(taskUrl.searchParams.get('sprint'), '123');
        assert.equal(taskUrl.searchParams.get('sprintName'), '2026Q3');
        assert.equal(taskUrl.searchParams.get('team'), 'all');
        assert.equal(taskUrl.searchParams.get('project'), 'product');
        assert.equal(taskUrl.searchParams.get('groupId'), 'group-a');
        assert.equal(taskUrl.searchParams.get('refresh'), 'true');
        assert.equal(taskUrl.searchParams.get('teamIds'), 'team-1,team-2');
        assert.equal(taskUrl.searchParams.get('teamLabels'), 'team_alpha_label,team_beta_label');
        assert.equal(taskUrl.searchParams.get('purpose'), 'alerts');
        assert.equal(taskUrl.searchParams.get('epicKeys'), 'EPM-1,EPM-2');
        assert.ok(taskUrl.searchParams.get('t'), 'Expected task cache-busting timestamp');
        assert.equal(calls[0].options.method, 'GET');
        assert.equal(calls[0].options.cache, 'no-cache');
        assert.equal(calls[0].options.signal, signal);
        assertJsonHeader(calls[0].options);

        assert.equal(calls[1].url, 'http://backend/api/dependencies');
        assert.equal(calls[1].options.method, 'POST');
        assert.equal(calls[1].options.signal, signal);
        assert.equal(calls[1].options.body, JSON.stringify({ keys: ['EPM-1', 'EPM-2'] }));
        assertJsonHeader(calls[1].options);

        const missingUrl = new URL(calls[2].url);
        assert.equal(missingUrl.pathname, '/api/missing-info');
        assert.equal(missingUrl.searchParams.get('sprint'), '123');
        assert.equal(missingUrl.searchParams.get('teamIds'), 'team-1');
        assert.equal(missingUrl.searchParams.get('components'), 'Comp A');
        assert.ok(missingUrl.searchParams.get('t'), 'Expected missing-info cache-busting timestamp');
        assert.equal(calls[2].options.method, 'GET');
        assert.equal(calls[2].options.cache, 'no-cache');
        assert.equal(calls[2].options.signal, signal);
        assertJsonHeader(calls[2].options);

        const backlogUrl = new URL(calls[3].url);
        assert.equal(backlogUrl.pathname, '/api/backlog-epics');
        assert.equal(backlogUrl.searchParams.get('project'), 'tech');
        assert.equal(backlogUrl.searchParams.get('teamIds'), 'team-1');
        assert.ok(backlogUrl.searchParams.get('t'), 'Expected backlog cache-busting timestamp');
        assert.equal(calls[3].options.method, 'GET');
        assert.equal(calls[3].options.cache, 'no-cache');
        assertJsonHeader(calls[3].options);
        assert.deepEqual(backlogPayload, { ok: true });

        const excludedUrl = new URL(calls[4].url);
        assert.equal(excludedUrl.pathname, '/api/stats/excluded-capacity-source');
        assert.equal(calls[4].options.method, 'POST');
        assert.equal(calls[4].options.cache, 'no-cache');
        assert.equal(calls[4].options.signal, signal);
        assert.deepEqual(JSON.parse(calls[4].options.body), {
            sprintIds: ['101', '102'],
            teamIds: ['team-1']
        });
        assertJsonHeader(calls[4].options);
        assert.equal(new Headers(calls[4].options.headers).get('X-Requested-With'), 'jira-execution-planner');
    });
});

test('settings API wrappers preserve save body shapes and no-cache reads', async () => {
    const { getJson } = loadHttpHelpers();
    const configApi = loadApiModule('configApi.js', [
        'fetchAppConfig',
        'fetchBoardConfig',
        'saveGroupPreferences',
        'saveGroupsConfig',
        'savePriorityWeightsConfig',
        'saveSelectedProjects',
    ], { getJson });
    const groupsPayload = { version: 1, groups: [{ id: 'default' }], defaultGroupId: 'default' };
    const preferencesPayload = { visibleGroupIds: ['platform'], activeGroupId: 'platform' };
    const weights = [{ priority: 'High', weight: 2 }];
    const selected = [{ key: 'ABC', type: 'product' }];

    await withMockFetch(async (calls) => {
        const appConfig = await configApi.fetchAppConfig('http://backend');
        await configApi.fetchBoardConfig('http://backend');
        await configApi.saveGroupsConfig('http://backend', groupsPayload);
        await configApi.saveGroupPreferences('http://backend', preferencesPayload);
        await configApi.savePriorityWeightsConfig('http://backend', weights);
        await configApi.saveSelectedProjects('http://backend', selected);

        assert.deepEqual(appConfig, { ok: true });
        assert.equal(calls[0].url, 'http://backend/api/config?includeViewConfig=true');
        assert.deepEqual(calls[0].options, {});

        assert.equal(calls[1].url, 'http://backend/api/board-config');
        assert.equal(calls[1].options.method, 'GET');
        assert.equal(calls[1].options.cache, 'no-cache');
        assertJsonHeader(calls[1].options);

        assert.equal(calls[2].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[3].url, 'http://backend/api/groups-config');
        assert.equal(calls[3].options.method, 'POST');
        assert.equal(calls[3].options.body, JSON.stringify(groupsPayload));
        assert.equal(new Headers(calls[3].options.headers).get('X-CSRF-Token'), 'csrf-token-2');
        assertJsonHeader(calls[3].options);

        assert.equal(calls[4].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[5].url, 'http://backend/api/groups-preferences');
        assert.equal(calls[5].options.method, 'POST');
        assert.equal(calls[5].options.body, JSON.stringify(preferencesPayload));
        assert.equal(new Headers(calls[5].options.headers).get('X-CSRF-Token'), 'csrf-token-4');
        assertJsonHeader(calls[5].options);

        assert.equal(calls[6].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[7].url, 'http://backend/api/stats/priority-weights-config');
        assert.equal(calls[7].options.method, 'POST');
        assert.equal(calls[7].options.body, JSON.stringify({ weights }));
        assert.equal(new Headers(calls[7].options.headers).get('X-CSRF-Token'), 'csrf-token-6');
        assertJsonHeader(calls[7].options);

        assert.equal(calls[8].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[9].url, 'http://backend/api/projects/selected');
        assert.equal(calls[9].options.method, 'POST');
        assert.equal(calls[9].options.body, JSON.stringify({ selected }));
        assert.equal(new Headers(calls[9].options.headers).get('X-CSRF-Token'), 'csrf-token-8');
        assertJsonHeader(calls[9].options);
    }, (url, _options, index) => {
        if (String(url).endsWith('/api/auth/csrf')) {
            return jsonResponse({ csrfToken: `csrf-token-${index}` });
        }
        return jsonResponse({ ok: true });
    });
});

test('group preferences save wrapper uses settings analytics metadata', async () => {
    const { getJson } = loadHttpHelpers();
    const trackedCalls = [];
    const configApi = loadApiModule('configApi.js', [
        'saveGroupPreferences',
    ], {
        getJson,
        trackedFetch: async (apiSurface, url, options, analyticsParams) => {
            trackedCalls.push({ apiSurface, url, options, analyticsParams });
            return jsonResponse({ ok: true });
        },
    });

    await withMockFetch(async () => {
        await configApi.saveGroupPreferences('http://backend', {
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
        });
    }, (url) => {
        if (String(url).endsWith('/api/auth/csrf')) {
            return jsonResponse({ csrfToken: 'csrf-token' });
        }
        return jsonResponse({ ok: true });
    });

    assert.equal(trackedCalls.length, 1);
    assert.equal(trackedCalls[0].apiSurface, 'settings_save');
    assert.equal(trackedCalls[0].url, 'http://backend/api/groups-preferences');
    assert.deepEqual(trackedCalls[0].analyticsParams, { featureName: 'settings' });
    assert.equal(new Headers(trackedCalls[0].options.headers).get('X-CSRF-Token'), 'csrf-token');
    assertJsonHeader(trackedCalls[0].options);
});

test('excluded capacity stats source wrapper can request a backend refresh', async () => {
    const engApi = loadApiModule('engApi.js', [
        'fetchExcludedCapacityStatsSource',
    ]);

    await withMockFetch(async (calls) => {
        await engApi.fetchExcludedCapacityStatsSource('http://backend', {
            sprintIds: ['101'],
            teamIds: ['team-1'],
            refresh: true,
        });

        assert.equal(calls[0].url, 'http://backend/api/stats/excluded-capacity-source');
        assert.deepEqual(JSON.parse(calls[0].options.body), {
            sprintIds: ['101'],
            teamIds: ['team-1'],
            refresh: true,
        });
        assertJsonHeader(calls[0].options);
    });
});

test('app config wrapper preserves resolved view metadata and legacy epm shape', () => {
    const { getJson } = loadHttpHelpers();
    const configApi = loadApiModule('configApi.js', [
        'normalizeAppConfig',
    ], { getJson });

    const epm = { version: 2, projects: { 'home-1': { label: 'rnd_project_synthetic' } } };
    const normalized = configApi.normalizeAppConfig({
        viewConfig: {
            source: 'user_saved_view',
            workspaceId: 'workspace-1',
            viewConfigId: 'view-1',
            viewType: 'epm',
            view: { epm },
        },
    });

    assert.deepEqual(normalized.epm, epm);
    assert.equal(normalized.viewConfig.source, 'user_saved_view');

    const withLegacyEpm = configApi.normalizeAppConfig({
        epm: { version: 2, projects: {} },
        viewConfig: { view: { epm } },
    });
    assert.deepEqual(withLegacyEpm.epm, { version: 2, projects: {} });
});

test('Jira catalog API wrappers preserve query params, cache flags, and abort signals', async () => {
    const { getJson } = loadHttpHelpers();
    const jiraCatalogApi = loadApiModule('jiraCatalogApi.js', [
        'fetchJiraLabels',
        'fetchAllTeams',
        'searchProjects',
        'fetchFields',
        'saveTeamCatalog',
    ], { getJson });
    const signal = new AbortController().signal;

    await withMockFetch(async (calls) => {
        const labelsPayload = await jiraCatalogApi.fetchJiraLabels('http://backend', {
            prefix: 'rnd_project_*',
            limit: 200,
        });
        await jiraCatalogApi.searchProjects('http://backend', { query: 'ABC Project', signal });
        await jiraCatalogApi.fetchAllTeams('http://backend', { sprint: '42' });
        await jiraCatalogApi.fetchFields('http://backend', { projectKey: 'ABC DEF' });
        await jiraCatalogApi.saveTeamCatalog('http://backend', {
            catalog: { teams: [] },
            meta: { updatedAt: 'now' },
            merge: true,
        });

        assert.deepEqual(labelsPayload, { ok: true });
        const labelsUrl = new URL(calls[0].url);
        assert.equal(labelsUrl.pathname, '/api/jira/labels');
        assert.equal(labelsUrl.searchParams.get('prefix'), 'rnd_project_*');
        assert.equal(labelsUrl.searchParams.get('limit'), '200');
        assert.equal(calls[0].options.cache, 'no-cache');

        const searchUrl = new URL(calls[1].url);
        assert.equal(searchUrl.pathname, '/api/projects');
        assert.equal(searchUrl.searchParams.get('query'), 'ABC Project');
        assert.equal(searchUrl.searchParams.get('limit'), '25');
        assert.equal(calls[1].options.method, 'GET');
        assert.equal(calls[1].options.cache, 'no-cache');
        assert.equal(calls[1].options.signal, signal);
        assertJsonHeader(calls[1].options);

        const teamsUrl = new URL(calls[2].url);
        assert.equal(teamsUrl.pathname, '/api/teams');
        assert.equal(teamsUrl.searchParams.get('sprint'), '42');
        assert.equal(teamsUrl.searchParams.get('all'), 'true');
        assert.ok(teamsUrl.searchParams.get('_t'), 'Expected teams cache-busting timestamp');
        assert.equal(calls[2].options, undefined);

        const fieldsUrl = new URL(calls[3].url);
        assert.equal(fieldsUrl.pathname, '/api/fields');
        assert.equal(fieldsUrl.searchParams.get('project'), 'ABC DEF');
        assert.equal(calls[3].options.method, 'GET');
        assert.equal(calls[3].options.cache, 'no-cache');
        assertJsonHeader(calls[3].options);

        assert.equal(calls[4].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[5].url, 'http://backend/api/team-catalog');
        assert.equal(calls[5].options.method, 'POST');
        assert.equal(calls[5].options.body, JSON.stringify({
            catalog: { teams: [] },
            meta: { updatedAt: 'now' },
            merge: true,
        }));
        assert.equal(new Headers(calls[5].options.headers).get('X-CSRF-Token'), 'csrf-token-4');
        assertJsonHeader(calls[5].options);
    }, (url, _options, index) => {
        if (String(url).endsWith('/api/auth/csrf')) {
            return jsonResponse({ csrfToken: `csrf-token-${index}` });
        }
        return jsonResponse({ ok: true });
    });
});

test('auth API wrappers preserve Home token request details and CSRF use', async () => {
    const { json, getJson, postJson } = loadHttpHelpers();
    const authApi = loadApiModule('authApi.js', [
        'connectHomeTokenConnection',
        'deleteHomeTokenConnection',
        'fetchAuthStatus',
        'fetchHomeTokenConnection',
        'refreshAuthSession',
    ], { json, getJson, postJson });

    await withMockFetch(async (calls) => {
        await authApi.fetchAuthStatus('http://backend');
        await authApi.fetchHomeTokenConnection('http://backend');
        await authApi.refreshAuthSession('http://backend');
        await authApi.connectHomeTokenConnection('http://backend', {
            email: 'user@example.com',
            apiToken: 'plain-user-token',
        });
        await authApi.deleteHomeTokenConnection('http://backend');

        assert.equal(calls[0].url, 'http://backend/api/auth/status');
        assert.equal(calls[0].options.cache, 'no-cache');

        assert.equal(calls[1].url, 'http://backend/api/me/connections/home-token');
        assert.equal(calls[1].options.cache, 'no-cache');

        assert.equal(calls[2].url, 'http://backend/api/auth/refresh');
        assert.equal(calls[2].options.method, 'POST');
        assert.equal(calls[2].options.credentials, 'same-origin');
        assert.equal(new Headers(calls[2].options.headers).get('X-Requested-With'), 'jira-execution-planner');

        assert.equal(calls[3].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[4].url, 'http://backend/api/me/connections/home-token');
        assert.equal(calls[4].options.method, 'POST');
        assert.equal(calls[4].options.body, JSON.stringify({
            email: 'user@example.com',
            apiToken: 'plain-user-token',
        }));
        assert.equal(new Headers(calls[4].options.headers).get('X-CSRF-Token'), 'csrf-token-3');
        assertJsonHeader(calls[4].options);

        assert.equal(calls[5].url, 'http://backend/api/auth/csrf');
        assert.equal(calls[6].url, 'http://backend/api/me/connections/home-token');
        assert.equal(calls[6].options.method, 'DELETE');
        assert.equal(new Headers(calls[6].options.headers).get('X-CSRF-Token'), 'csrf-token-5');
        assertJsonHeader(calls[6].options);
    }, (url, _options, index) => {
        if (String(url).endsWith('/api/auth/csrf')) {
            return jsonResponse({ csrfToken: `csrf-token-${index}` });
        }
        return jsonResponse({ ok: true });
    });
});

test('Scenario API module owns draft, realtime, and run endpoint construction', () => {
    const scenarioApiPath = path.join(frontendSrcPath, 'api', 'scenarioApi.js');
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));
    assert.ok(fs.existsSync(scenarioApiPath), 'Expected frontend/src/api/scenarioApi.js to exist');

    const scenarioApiSource = readSource(scenarioApiPath);

    assert.ok(scenarioApiSource.includes('/api/scenario/drafts?scope_key='), 'Expected draft load URL construction in scenarioApi.js');
    assert.ok(scenarioApiSource.includes('/api/scenario/drafts/${encodeURIComponent(draftId)}${path}'), 'Expected draft path construction in scenarioApi.js');
    assert.ok(scenarioApiSource.includes('/api/scenario/drafts'), 'Expected draft save URL construction in scenarioApi.js');
    assert.ok(scenarioApiSource.includes('/api/scenario'), 'Expected scenario run URL construction in scenarioApi.js');
    assert.ok(scenarioApiSource.includes("'X-CSRF-Token': csrfToken"), 'Expected scenario CSRF header in scenarioApi.js');
    assert.ok(dashboardSource.includes("from './api/scenarioApi.js'"), 'Expected dashboard to import scenario API wrappers');
    assert.equal(/(^|[^.])\/api\/scenario/.test(dashboardSource), false, 'dashboard.jsx must not own scenario endpoint literals');
});

test('Scenario API wrappers preserve request details and error payloads', async () => {
    const scenarioApi = loadApiModule('scenarioApi.js', [
        'buildScenarioDraftEventsStreamUrl',
        'fetchScenarioDraft',
        'fetchScenarioDraftVersion',
        'fetchScenarioRun',
        'pollScenarioDraftEvents',
        'postScenarioRealtimeJson',
        'reloadScenarioDraftFromJira',
        'rollbackScenarioDraft',
        'saveScenarioDraftVersion',
    ]);
    const signal = new AbortController().signal;

    await withMockFetch(async (calls) => {
        await scenarioApi.fetchScenarioDraft('http://backend', 'group::sprint', { signal });
        await scenarioApi.postScenarioRealtimeJson('http://backend', 'draft-1', '/locks', { action: 'acquire' }, { csrfToken: 'csrf-a' });
        await scenarioApi.pollScenarioDraftEvents('http://backend', 'draft-1', 7, { signal });
        await scenarioApi.saveScenarioDraftVersion('http://backend', { scope_key: 'group::sprint' }, { csrfToken: 'csrf-b' });
        await scenarioApi.fetchScenarioDraftVersion('http://backend', 'draft-1', 3, { signal });
        await scenarioApi.rollbackScenarioDraft('http://backend', 'draft-1', { targetVersionNumber: 2, baseDraftRevision: 5 }, { csrfToken: 'csrf-c', signal });
        await scenarioApi.reloadScenarioDraftFromJira('http://backend', 'draft-1', { baseDraftRevision: 6 }, { csrfToken: 'csrf-d', signal });
        await scenarioApi.fetchScenarioRun('http://backend', { filters: { sprint: '42' } }, { signal });
        const streamUrl = scenarioApi.buildScenarioDraftEventsStreamUrl('http://backend', 'draft-1', 8);

        assert.equal(new URL(calls[0].url).pathname, '/api/scenario/drafts');
        assert.equal(new URL(calls[0].url).searchParams.get('scope_key'), 'group::sprint');
        assert.equal(calls[0].options.cache, 'no-cache');
        assert.equal(calls[0].options.signal, signal);

        assert.equal(calls[1].url, 'http://backend/api/scenario/drafts/draft-1/locks');
        assert.equal(calls[1].options.method, 'POST');
        assert.equal(calls[1].options.body, JSON.stringify({ action: 'acquire' }));
        assert.equal(new Headers(calls[1].options.headers).get('X-CSRF-Token'), 'csrf-a');
        assertJsonHeader(calls[1].options);

        assert.equal(calls[2].url, 'http://backend/api/scenario/drafts/draft-1/events?since=7');
        assert.equal(calls[2].options.signal, signal);

        assert.equal(calls[3].url, 'http://backend/api/scenario/drafts');
        assert.equal(calls[3].options.method, 'POST');
        assert.equal(new Headers(calls[3].options.headers).get('X-CSRF-Token'), 'csrf-b');

        assert.equal(calls[4].url, 'http://backend/api/scenario/drafts/draft-1/versions/3');
        assert.equal(calls[4].options.signal, signal);

        assert.equal(calls[5].url, 'http://backend/api/scenario/drafts/draft-1/rollback');
        assert.equal(calls[5].options.method, 'POST');
        assert.equal(calls[5].options.signal, signal);
        assert.deepEqual(JSON.parse(calls[5].options.body), {
            targetVersionNumber: 2,
            baseDraftRevision: 5,
        });
        assert.equal(new Headers(calls[5].options.headers).get('X-CSRF-Token'), 'csrf-c');

        assert.equal(calls[6].url, 'http://backend/api/scenario/drafts/draft-1/reload-from-jira');
        assert.equal(calls[6].options.method, 'POST');
        assert.equal(new Headers(calls[6].options.headers).get('X-CSRF-Token'), 'csrf-d');

        assert.equal(calls[7].url, 'http://backend/api/scenario');
        assert.equal(calls[7].options.method, 'POST');
        assert.equal(calls[7].options.signal, signal);
        assert.deepEqual(JSON.parse(calls[7].options.body), { filters: { sprint: '42' } });
        assertJsonHeader(calls[7].options);
        assert.equal(new Headers(calls[7].options.headers).get('X-Requested-With'), 'jira-execution-planner');

        assert.equal(streamUrl, 'http://backend/api/scenario/drafts/draft-1/events/stream?since=8');
    });
});

test('Stats and issues API modules own dashboard stats and lookup endpoints', () => {
    const statsApiPath = path.join(frontendSrcPath, 'api', 'statsApi.js');
    const issuesApiPath = path.join(frontendSrcPath, 'api', 'issuesApi.js');
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));
    assert.ok(fs.existsSync(statsApiPath), 'Expected frontend/src/api/statsApi.js to exist');
    assert.ok(fs.existsSync(issuesApiPath), 'Expected frontend/src/api/issuesApi.js to exist');

    const statsApiSource = readSource(statsApiPath);
    const issuesApiSource = readSource(issuesApiPath);

    assert.ok(statsApiSource.includes('/api/stats/burnout'), 'Expected burnout URL construction in statsApi.js');
    assert.ok(statsApiSource.includes('/api/stats/epic-cohort'), 'Expected epic cohort URL construction in statsApi.js');
    assert.ok(statsApiSource.includes('/api/stats/project-track-phase-durations'), 'Expected Project Track phase URL construction in statsApi.js');
    assert.ok(issuesApiSource.includes('/api/issues/lookup?keys='), 'Expected issue lookup URL construction in issuesApi.js');
    assert.ok(dashboardSource.includes("from './api/statsApi.js'"), 'Expected dashboard to import stats API wrappers');
    assert.ok(dashboardSource.includes("from './api/issuesApi.js'"), 'Expected dashboard to import issue lookup API wrapper');
    assert.equal(/(^|[^.])\/api\/stats/.test(dashboardSource), false, 'dashboard.jsx must not own stats endpoint literals');
    assert.equal(/(^|[^.])\/api\/issues/.test(dashboardSource), false, 'dashboard.jsx must not own issue lookup endpoint literals');
});

test('Stats and issues API wrappers preserve request details', async () => {
    const statsApi = loadApiModule('statsApi.js', [
        'fetchBurnoutStats',
        'fetchEpicCohortStats',
        'fetchProjectTrackPhaseDurations',
    ]);
    const issuesApi = loadApiModule('issuesApi.js', [
        'fetchIssuesLookup',
    ]);
    const signal = new AbortController().signal;

    await withMockFetch(async (calls) => {
        await statsApi.fetchBurnoutStats('http://backend', {
            sprint: 'Sprint 1',
            teamIds: ['team-1'],
            issueKeys: ['ABC-1'],
            includePostSprintClosures: false,
        }, { signal });
        await statsApi.fetchEpicCohortStats('http://backend', {
            startQuarter: '2026 Q1',
            teamIds: ['team-1'],
            components: ['Comp A'],
            refresh: false,
        }, { signal });
        await statsApi.fetchProjectTrackPhaseDurations('http://backend', {
            epicKeys: ['EPIC-1'],
            refresh: true,
            signal,
        });
        await issuesApi.fetchIssuesLookup('http://backend', ['ABC-1', 'XYZ-2'], { signal });

        assert.equal(calls[0].url, 'http://backend/api/stats/burnout');
        assert.equal(calls[0].options.method, 'POST');
        assert.equal(calls[0].options.cache, 'no-cache');
        assert.equal(calls[0].options.signal, signal);
        assert.equal(new Headers(calls[0].options.headers).get('X-Requested-With'), 'jira-execution-planner');
        assert.deepEqual(JSON.parse(calls[0].options.body), {
            sprint: 'Sprint 1',
            teamIds: ['team-1'],
            issueKeys: ['ABC-1'],
            includePostSprintClosures: false,
        });
        assertJsonHeader(calls[0].options);

        assert.equal(calls[1].url, 'http://backend/api/stats/epic-cohort');
        assert.equal(calls[1].options.method, 'POST');
        assert.equal(calls[1].options.cache, 'no-cache');
        assert.equal(calls[1].options.signal, signal);
        assert.deepEqual(JSON.parse(calls[1].options.body), {
            startQuarter: '2026 Q1',
            teamIds: ['team-1'],
            components: ['Comp A'],
            refresh: false,
        });
        assertJsonHeader(calls[1].options);

        assert.equal(calls[2].url, 'http://backend/api/stats/project-track-phase-durations');
        assert.equal(calls[2].options.method, 'POST');
        assert.equal(calls[2].options.cache, 'no-cache');
        assert.equal(calls[2].options.signal, signal);
        assert.deepEqual(JSON.parse(calls[2].options.body), {
            epicKeys: ['EPIC-1'],
            refresh: true,
        });
        assertJsonHeader(calls[2].options);

        const lookupUrl = new URL(calls[3].url);
        assert.equal(lookupUrl.pathname, '/api/issues/lookup');
        assert.equal(lookupUrl.searchParams.get('keys'), 'ABC-1,XYZ-2');
        assert.equal(calls[3].options.signal, signal);
    });
});
