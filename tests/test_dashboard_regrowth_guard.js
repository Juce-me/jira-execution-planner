const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { repoRoot } = require('./frontend_source_helpers');

// dashboard.jsx may not regrow: its line count and its React hook occurrences are exact ceilings in
// scripts/extraction_lint/owner_budgets.json (`dashboard.lineCeiling` and `dashboard.hookCeilings`). The ceilings are exact on
// purpose: a feature that adds an App-level hook edits one manifest line, which is the friction this guard creates, and a PR
// that removes hooks lowers the matching line so the room cannot be spent elsewhere. Counts are occurrences (`rg -o` semantics).
const HOOKS = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useReducer', 'useLayoutEffect'];
const MANIFEST = 'scripts/extraction_lint/owner_budgets.json';

const countOccurrences = (text, needle) => text.split(needle).length - 1;
const countLines = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

// Returns one message per exceeded ceiling; each names the manifest line to edit.
function regrowthFailures(source, dashboard) {
    const failures = [];
    const lines = countLines(source);
    if (lines > dashboard.lineCeiling) failures.push(`${dashboard.path} has ${lines} lines, above dashboard.lineCeiling ${dashboard.lineCeiling}: shrink it, or edit "lineCeiling" under "dashboard" in ${MANIFEST}`);
    for (const hook of HOOKS) {
        const ceiling = dashboard.hookCeilings?.[hook];
        const count = countOccurrences(source, `${hook}(`);
        if (!Number.isInteger(ceiling)) failures.push(`${MANIFEST} dashboard.hookCeilings.${hook} is missing or not an integer`);
        else if (count > ceiling) failures.push(`${dashboard.path} has ${count} occurrences of ${hook}( , above dashboard.hookCeilings.${hook} ${ceiling}: move the hook out of App(), or edit "${hook}" under "dashboard.hookCeilings" in ${MANIFEST}`);
    }
    return failures;
}

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST), 'utf8'));
const dashboard = manifest.dashboard;
const source = fs.readFileSync(path.join(repoRoot, dashboard.path), 'utf8');

test('dashboard.jsx stays within its line and hook-count ceilings', () => {
    assert.deepEqual(regrowthFailures(source, dashboard), []);
});

test('the regrowth guard fails one over a ceiling and names the manifest line', () => {
    const lines = countLines(source);
    assert.equal(regrowthFailures(source, { ...dashboard, lineCeiling: lines }).length, 0);
    const overLines = regrowthFailures(source, { ...dashboard, lineCeiling: lines - 1 });
    assert.equal(overLines.length, 1);
    assert.match(overLines[0], /dashboard\.lineCeiling .*"lineCeiling" under "dashboard" in scripts\/extraction_lint\/owner_budgets\.json/);
    for (const hook of HOOKS) {
        const count = countOccurrences(source, `${hook}(`);
        const exact = { ...dashboard, hookCeilings: { ...dashboard.hookCeilings, [hook]: count } };
        assert.deepEqual(regrowthFailures(source, exact), [], `${hook} at its ceiling must pass`);
        if (count === 0) continue;
        const over = regrowthFailures(source, { ...dashboard, hookCeilings: { ...dashboard.hookCeilings, [hook]: count - 1 } });
        assert.equal(over.length, 1, `${hook} one over must fail`);
        assert.match(over[0], new RegExp(`dashboard\\.hookCeilings\\.${hook} .*"${hook}" under "dashboard\\.hookCeilings" in scripts/extraction_lint/owner_budgets\\.json`));
    }
});

test('the counter measures a synthetic source and rejects a missing ceiling', () => {
    const synthetic = 'useState(1); React.useState(2); useEffect(() => 0, []);\nuseMemo(() => 1, []);\n';
    assert.equal(countOccurrences(synthetic, 'useState('), 2);
    assert.equal(countLines(synthetic), 2);
    const failures = regrowthFailures(synthetic, { path: 'x.jsx', lineCeiling: 2, hookCeilings: { useState: 1 } });
    assert.ok(failures.some((message) => /useState\( , above dashboard\.hookCeilings\.useState 1/.test(message)));
    assert.ok(failures.some((message) => /hookCeilings\.useEffect is missing/.test(message)));
});
