const test = require('node:test');
const assert = require('node:assert/strict');
const { readOwnerSource } = require('./frontend_source_helpers');

test('missing-label rule requires epic to match the selected sprint', () => {
    const source = readOwnerSource(['frontend/src/dashboard.jsx', 'frontend/src/eng/useEngAlerts.js'], { anchor: 'export function useEngAlerts' });

    assert.equal(
        source.includes('if (!epicMatchesPlanningSprintValue(epic)) return false;'),
        true
    );
});

test('missing-label rule passes the Team half when any alias of the resolved Team is present', () => {
    const source = readOwnerSource(['frontend/src/dashboard.jsx', 'frontend/src/eng/useEngAlerts.js'], { anchor: 'export function useEngAlerts' });
    const start = source.indexOf('const missingLabelEpics = React.useMemo(');
    assert.notEqual(start, -1);
    const block = source.slice(start, source.indexOf('const missingLabelEpicKeySet', start));

    assert.match(block, /if \(!epicMatchesPlanningSprintValue\(epic\)\) return false;/);
    assert.match(block, /!epicHasPlanningSprintLabel\(epic\)/);
    assert.match(block, /epicHasFuturePlanningTeamLabel\(epic, \{/);
    // Word-boundary match: the removed singular helper name is a prefix of
    // the still-used plural `getFuturePlanningExpectedTeamLabels`, so a
    // plain substring check would false-positive on the plural.
    assert.equal(/getFuturePlanningExpectedTeamLabel\b/.test(source), false);
    assert.equal(source.includes('getFuturePlanningTeamLabel'), false);
});

test('active group Team labels normalize through the shared alias helper', () => {
    const source = readOwnerSource(['frontend/src/dashboard.jsx', 'frontend/src/eng/useEngAlerts.js'], { anchor: 'export function useEngAlerts' });
    const start = source.indexOf('const normalizedActiveGroupTeamLabels = React.useMemo(');
    assert.notEqual(start, -1);
    const block = source.slice(start, source.indexOf('}, [activeGroupTeamLabels]);', start));

    assert.match(block, /normalizeTeamLabelAliases\(/);
    assert.doesNotMatch(block, /String\(label/);
});
