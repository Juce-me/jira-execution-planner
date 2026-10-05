const test = require('node:test');
const assert = require('node:assert/strict');
const { readOwnerSource } = require('./frontend_source_helpers');

// Characterization for the Settings extraction (docs/plans/EXEC-dashboard-scenario-settings-state-extraction.md,
// ST1 R2): the five places that enumerate the 11 administrator sections must stay equal, and the
// render-time draft snapshot must keep its 10-key projection (every section except adminAccess).
// Each location is read through readOwnerSource with an anchor, so the pin follows the code when
// ST4/ST5 move it out of dashboard.jsx and goes loud rather than vacuous if the anchor disappears.
const OWNERS = ['frontend/src/dashboard.jsx', 'frontend/src/settings'];

const ADMIN_SECTIONS = [
    'projects', 'priorityWeights', 'board', 'capacity', 'sprintField', 'parentNameField',
    'storyPointsField', 'teamField', 'deliveryOwnerField', 'issueTypes', 'adminAccess',
];

// Keys declared directly on the object literal that opens at `source[open]`.
function topLevelKeys(source, open) {
    assert.equal(source[open], '{');
    const keys = [];
    let depth = 0;
    let expectKey = false;
    for (let i = open; i < source.length; i += 1) {
        const char = source[i];
        if (char === '"' || char === "'" || char === '`') {
            for (i += 1; source[i] !== char; i += 1) {
                assert.ok(i < source.length, 'unterminated string in object literal');
                if (source[i] === '\\') i += 1;
            }
            continue;
        }
        if ('{[('.includes(char)) {
            depth += 1;
            expectKey = depth === 1;
        } else if (')}]'.includes(char)) {
            depth -= 1;
            if (depth === 0) return keys;
        } else if (char === ',' && depth === 1) {
            expectKey = true;
        } else if (expectKey && depth === 1 && /[A-Za-z_$]/.test(char)) {
            const key = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))[0];
            if (source[i + key.length] === ':') keys.push(key);
            i += key.length - 1;
            expectKey = false;
        }
    }
    throw new Error('unterminated object literal');
}

function objectKeysAfter(source, anchor) {
    const at = source.indexOf(anchor);
    assert.notEqual(at, -1, `missing anchor: ${anchor}`);
    return topLevelKeys(source, source.indexOf('{', at + anchor.length - 1));
}

test('the helper reads only top-level keys', () => {
    assert.deepEqual(topLevelKeys("{ a: 1, b: { c: 2 }, d: [e, { f: 3 }], g: fn({ h: 4 }), i: 'x, j: 5' }", 0), ['a', 'b', 'd', 'g', 'i']);
});

test('the first-run admin key list names the 11 administrator sections in order', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'export const FIRST_RUN_ADMIN_SECTION_KEYS = [' });
    const start = source.indexOf('export const FIRST_RUN_ADMIN_SECTION_KEYS = [');
    const list = source.slice(start, source.indexOf('];', start));
    assert.deepEqual([...list.matchAll(/'(\w+)'/g)].map(match => match[1]), ADMIN_SECTIONS);
});

test('the save map covers the 11 administrator sections', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'const adminSectionsToSave = {' });
    assert.deepEqual(objectKeysAfter(source, 'const adminSectionsToSave = {').sort(), [...ADMIN_SECTIONS].sort());
});

test('the first-run draft capture covers the 11 administrator sections', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'const captureFirstRunSettingsDrafts' });
    const capture = source.slice(source.indexOf('const captureFirstRunSettingsDrafts'));
    assert.deepEqual(objectKeysAfter(capture, 'admin: {').sort(), [...ADMIN_SECTIONS].sort());
});

test('the first-run draft restore covers the 11 administrator sections', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'const restoreSettingsDraftsToCommittedBaselines' });
    const start = source.indexOf('const restoreSettingsDraftsToCommittedBaselines');
    const end = source.indexOf('const returnFromFirstRunConfigurationRecovery', start);
    assert.notEqual(end, -1, 'missing restore end marker');
    const restore = source.slice(start, end);
    const restored = new Set([
        ...[...restore.matchAll(/committed\.(\w+)/g)].map(match => match[1]),
        ...[...restore.matchAll(/restoreField\('(\w+)'/g)].map(match => match[1]),
    ]);
    assert.deepEqual([...restored].sort(), [...ADMIN_SECTIONS].sort());
});

test('the render-time draft snapshot projects the 10 sections that have a draft, without adminAccess', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'settingsDraftSnapshotRef.current = {' });
    const keys = objectKeysAfter(source, 'settingsDraftSnapshotRef.current = {');
    assert.equal(keys.length, 10);
    assert.deepEqual([...keys].sort(), ADMIN_SECTIONS.filter(key => key !== 'adminAccess').sort());
    assert.equal(keys.includes('adminAccess'), false);
});
