const test = require('node:test');
const assert = require('node:assert/strict');
const { readOwnerSource } = require('./frontend_source_helpers');

// ST2 R2: the EPM "private view only" pins as owner-directory checks, so they keep their meaning when
// the EPM settings code moves out of dashboard.jsx (docs/plans/DONE-dashboard-scenario-settings-state-extraction.md, ST2).
// Every positive pin carries an anchor so a negative pin cannot go vacuous.
const OWNERS = ['frontend/src/dashboard.jsx', 'frontend/src/settings', 'frontend/src/epm'];
const count = (source, text) => source.split(text).length - 1;

// Source of the arrow-function body that starts at `declaration` (brace matching, skipping strings and template literals).
function functionBody(source, declaration) {
    const start = source.indexOf(declaration);
    assert.notEqual(start, -1, `missing declaration: ${declaration}`);
    let i = source.indexOf('{', start + declaration.length - 1);
    const open = i;
    let depth = 0;
    for (; i < source.length; i += 1) {
        const char = source[i];
        if (char === '"' || char === "'" || char === '`') {
            for (i += 1; source[i] !== char; i += 1) {
                assert.ok(i < source.length, 'unterminated string');
                if (source[i] === '\\') i += 1;
            }
        } else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open, i + 1);
        }
    }
    throw new Error('unterminated function body');
}

test('the private view EPM wins the bootstrap seed exactly once', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'const personalEpm = config.viewConfig?.view?.epm || config.epm;' });
    assert.equal(count(source, 'const personalEpm = config.viewConfig?.view?.epm || config.epm;'), 1);
});

test('workspace administrator EPM never seeds the private draft', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'const personalEpm = config.viewConfig?.view?.epm || config.epm;' });
    assert.equal(source.includes('config.epm || sharedConfig.epm'), false);
    assert.equal(source.includes('sharedConfig.epm'), false);
});

test('the private EPM save reads no workspace revision and raises no workspace conflict', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'const saveEpmConfig = async () => {' });
    assert.equal(count(source, 'const saveEpmConfig = async () => {'), 1);
    const body = functionBody(source, 'const saveEpmConfig = async () => {');
    assert.ok(body.includes('requestSaveEpmConfig(BACKEND_URL, normalizedDraft)'));
    assert.equal(body.includes('sharedConfigRevisionRef'), false);
    assert.equal(body.includes('commitSharedConfigRevision'), false);
    assert.equal(body.includes('setWorkspaceConfigConflict'), false);
});

test('the helper reads only the owner function body, not what follows it', () => {
    const body = functionBody('const f = async () => { const a = `x}`; if (a) { return 1; } };\nconst g = () => { sharedConfigRevisionRef };', 'const f = async () => {');
    assert.equal(body.includes('sharedConfigRevisionRef'), false);
    assert.ok(body.endsWith('}'));
});
