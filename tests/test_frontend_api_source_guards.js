const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendSrcPath = path.join(__dirname, '..', 'frontend', 'src');
const apiPathSegment = `${path.sep}api${path.sep}`;
// Raw API endpoint literals belong under frontend/src/api during migration.
// dashboard.jsx remains an approved transitional wrapper until migrated.
const allowedTransitionalWrappers = new Set([
    path.join(frontendSrcPath, 'dashboard.jsx'),
]);

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
        .replaceAll('export async function ', 'async function ')
        .replaceAll('export function ', 'function ');
    return new Function(`${source}; return { json, getJson, postJson };`)();
}

function loadApiModule(fileName, exportNames, dependencies = {}) {
    const modulePath = path.join(frontendSrcPath, 'api', fileName);
    assert.ok(fs.existsSync(modulePath), `Expected frontend/src/api/${fileName} to exist`);
    const source = readSource(modulePath)
        .replace(/import\s+\{[^}]+\}\s+from\s+'\.\/http\.js';\n?/, '')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    const names = Object.keys(dependencies);
    const values = Object.values(dependencies);
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
        assert.equal(calls[0].options, getOptions);

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

test('EPM API module owns endpoint construction while epmFetch remains a compatibility re-export', () => {
    const epmApiPath = path.join(frontendSrcPath, 'api', 'epmApi.js');
    const epmFetchPath = path.join(frontendSrcPath, 'epm', 'epmFetch.js');
    assert.ok(fs.existsSync(epmApiPath), 'Expected frontend/src/api/epmApi.js to exist');

    const epmApiSource = readSource(epmApiPath);
    const epmFetchSource = readSource(epmFetchPath);

    assert.ok(epmApiSource.includes("from './http.js'"), 'Expected EPM API module to use shared HTTP helpers');
    assert.ok(epmApiSource.includes('/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}'), 'Expected project rollup URL construction in epmApi.js');
    assert.ok(epmApiSource.includes('/api/epm/projects/rollup/all?${params.toString()}'), 'Expected aggregate rollup URL construction in epmApi.js');
    assert.ok(epmApiSource.includes("fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {})"), 'Expected configuration project wrapper in epmApi.js');
    assert.ok(epmFetchSource.includes("export * from '../api/epmApi.js';"), 'Expected epmFetch.js to re-export the EPM API module');
    assert.ok(!/\/api\/epm(?:\/|\b)/.test(epmFetchSource), 'Did not expect EPM endpoint literals in compatibility wrapper');
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

test('settings config API module owns config request endpoint construction', () => {
    const configApiPath = path.join(frontendSrcPath, 'api', 'configApi.js');
    assert.ok(fs.existsSync(configApiPath), 'Expected frontend/src/api/configApi.js to exist');

    const configApiSource = readSource(configApiPath);
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));

    assert.ok(configApiSource.includes("from './http.js'"), 'Expected config API module to use shared HTTP helpers');
    assert.ok(configApiSource.includes('/api/config'), 'Expected app config URL construction in configApi.js');
    assert.ok(configApiSource.includes('/api/groups-config'), 'Expected groups config URL construction in configApi.js');
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

test('ENG API wrappers preserve task, backlog, dependency, and alert request details', async () => {
    const { getJson } = loadHttpHelpers();
    const engApi = loadApiModule('engApi.js', [
        'fetchMissingPlanningInfo',
        'fetchEngTasks',
        'fetchBacklogEpics',
        'fetchDependencies',
    ], { getJson });
    const signal = new AbortController().signal;

    await withMockFetch(async (calls) => {
        await engApi.fetchEngTasks('http://backend', {
            project: 'product',
            sprint: '123',
            groupId: 'group-a',
            teamIds: ['team-1', 'team-2'],
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

        const taskUrl = new URL(calls[0].url);
        assert.equal(taskUrl.pathname, '/api/tasks-with-team-name');
        assert.equal(taskUrl.searchParams.get('sprint'), '123');
        assert.equal(taskUrl.searchParams.get('team'), 'all');
        assert.equal(taskUrl.searchParams.get('project'), 'product');
        assert.equal(taskUrl.searchParams.get('groupId'), 'group-a');
        assert.equal(taskUrl.searchParams.get('refresh'), 'true');
        assert.equal(taskUrl.searchParams.get('teamIds'), 'team-1,team-2');
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
    });
});

test('settings API wrappers preserve save body shapes and no-cache reads', async () => {
    const { getJson } = loadHttpHelpers();
    const configApi = loadApiModule('configApi.js', [
        'fetchAppConfig',
        'fetchBoardConfig',
        'saveGroupsConfig',
        'savePriorityWeightsConfig',
        'saveSelectedProjects',
    ], { getJson });
    const groupsPayload = { version: 1, groups: [{ id: 'default' }], defaultGroupId: 'default' };
    const weights = [{ priority: 'High', weight: 2 }];
    const selected = [{ key: 'ABC', type: 'product' }];

    await withMockFetch(async (calls) => {
        const appConfig = await configApi.fetchAppConfig('http://backend');
        await configApi.fetchBoardConfig('http://backend');
        await configApi.saveGroupsConfig('http://backend', groupsPayload);
        await configApi.savePriorityWeightsConfig('http://backend', weights);
        await configApi.saveSelectedProjects('http://backend', selected);

        assert.deepEqual(appConfig, { ok: true });
        assert.equal(calls[0].url, 'http://backend/api/config');
        assert.deepEqual(calls[0].options, {});

        assert.equal(calls[1].url, 'http://backend/api/board-config');
        assert.equal(calls[1].options.method, 'GET');
        assert.equal(calls[1].options.cache, 'no-cache');
        assertJsonHeader(calls[1].options);

        assert.equal(calls[2].url, 'http://backend/api/groups-config');
        assert.equal(calls[2].options.method, 'POST');
        assert.equal(calls[2].options.body, JSON.stringify(groupsPayload));
        assertJsonHeader(calls[2].options);

        assert.equal(calls[3].url, 'http://backend/api/stats/priority-weights-config');
        assert.equal(calls[3].options.method, 'POST');
        assert.equal(calls[3].options.body, JSON.stringify({ weights }));
        assertJsonHeader(calls[3].options);

        assert.equal(calls[4].url, 'http://backend/api/projects/selected');
        assert.equal(calls[4].options.method, 'POST');
        assert.equal(calls[4].options.body, JSON.stringify({ selected }));
        assertJsonHeader(calls[4].options);
    });
});

test('Jira catalog API wrappers preserve query params, cache flags, and abort signals', async () => {
    const { getJson } = loadHttpHelpers();
    const jiraCatalogApi = loadApiModule('jiraCatalogApi.js', [
        'fetchJiraLabels',
        'fetchAllTeams',
        'searchProjects',
        'fetchFields',
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
    });
});
