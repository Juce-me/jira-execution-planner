const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendSrcPath = path.join(__dirname, '..', 'frontend', 'src');
const apiPathSegment = `${path.sep}api${path.sep}`;
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
