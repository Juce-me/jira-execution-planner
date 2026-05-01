const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendSrcPath = path.join(__dirname, '..', 'frontend', 'src');
const apiPathSegment = `${path.sep}api${path.sep}`;
// Raw API endpoint literals belong under frontend/src/api during migration.
// dashboard.jsx and epmFetch.js are approved transitional wrappers until migrated.
const allowedTransitionalWrappers = new Set([
    path.join(frontendSrcPath, 'dashboard.jsx'),
    path.join(frontendSrcPath, 'epm', 'epmFetch.js'),
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
        .filter((filePath) => /\/api\//.test(readSource(filePath)));

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
