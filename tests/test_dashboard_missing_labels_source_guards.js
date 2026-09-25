const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('missing-label rule requires epic to match the selected sprint', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
        'utf8'
    );

    assert.equal(
        source.includes('if (!epicMatchesPlanningSprintValue(epic)) return false;'),
        true
    );
});

test('missing-label rule passes the Team half when any alias of the resolved Team is present', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
        'utf8'
    );
    const start = source.indexOf('const missingLabelEpics = React.useMemo(');
    assert.notEqual(start, -1);
    const block = source.slice(start, source.indexOf('const missingLabelEpicKeySet', start));

    assert.match(block, /if \(!epicMatchesPlanningSprintValue\(epic\)\) return false;/);
    assert.match(block, /!epicHasPlanningSprintLabel\(epic\)/);
    assert.match(block, /epicHasFuturePlanningTeamLabel\(epic, \{/);
    assert.equal(source.includes('getFuturePlanningExpectedTeamLabel'), false);
    assert.equal(source.includes('getFuturePlanningTeamLabel'), false);
});

test('active group Team labels normalize through the shared alias helper', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
        'utf8'
    );
    const start = source.indexOf('const normalizedActiveGroupTeamLabels = React.useMemo(');
    assert.notEqual(start, -1);
    const block = source.slice(start, source.indexOf('}, [activeGroupTeamLabels]);', start));

    assert.match(block, /normalizeTeamLabelAliases\(/);
    assert.doesNotMatch(block, /String\(label/);
});
