const test = require('node:test');
const assert = require('node:assert/strict');

test('team selection resets to all when selected sprint has no data for the selected team', () => {
    return import('../frontend/src/teamSelectionUtils.mjs').then(({
        sanitizeSelectedTeamsForScope
    }) => {
        assert.deepEqual(
            sanitizeSelectedTeamsForScope(['team-a'], {
                activeGroupTeamIds: ['team-a', 'team-b'],
                availableTeamIds: ['team-b']
            }),
            ['all']
        );
    });
});

test('team selection keeps a selected team when it still has data in the selected sprint', () => {
    return import('../frontend/src/teamSelectionUtils.mjs').then(({
        sanitizeSelectedTeamsForScope
    }) => {
        assert.deepEqual(
            sanitizeSelectedTeamsForScope(['team-a'], {
                activeGroupTeamIds: ['team-a', 'team-b'],
                availableTeamIds: ['team-a', 'team-b']
            }),
            ['team-a']
        );
    });
});
