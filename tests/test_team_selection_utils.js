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

test('scoped team selection loads the stored team on refresh', async () => {
    const {
        buildTeamSelectionScopeKey,
        loadTeamSelectionState,
        saveTeamSelectionState
    } = await import('../frontend/src/teamSelectionPersistence.mjs');

    const storage = {
        data: {},
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
        },
        setItem(key, value) {
            this.data[key] = String(value);
        }
    };
    const scopeKey = buildTeamSelectionScopeKey({ sprintId: '2026Q2', groupId: 'group-alpha' });

    saveTeamSelectionState(storage, scopeKey, {
        selectedTeams: ['team-a']
    });

    assert.deepEqual(
        loadTeamSelectionState(storage, scopeKey),
        {
            selectedTeams: ['team-a'],
            selectedTeamId: 'team-a'
        }
    );
});

test('scoped team selection falls back to all when the new sprint no longer has the chosen team', async () => {
    const {
        reconcileTeamSelectionState
    } = await import('../frontend/src/teamSelectionPersistence.mjs');

    assert.deepEqual(
        reconcileTeamSelectionState({
            selectedTeams: ['team-a']
        }, {
            validTeamIds: new Set(['team-b'])
        }),
        {
            selectedTeams: ['all'],
            selectedTeamId: 'all'
        }
    );
});

test('scoped team selection preserves a valid team across sprint change', async () => {
    const {
        buildTeamSelectionScopeKey,
        loadTeamSelectionState,
        reconcileTeamSelectionState,
        saveTeamSelectionState
    } = await import('../frontend/src/teamSelectionPersistence.mjs');

    const storage = {
        data: {},
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
        },
        setItem(key, value) {
            this.data[key] = String(value);
        }
    };
    const sprintOneScope = buildTeamSelectionScopeKey({ sprintId: '2026Q2', groupId: 'group-alpha' });
    const sprintTwoScope = buildTeamSelectionScopeKey({ sprintId: '2026Q3', groupId: 'group-alpha' });

    saveTeamSelectionState(storage, sprintOneScope, {
        selectedTeams: ['team-a']
    });

    const preserved = reconcileTeamSelectionState(loadTeamSelectionState(storage, sprintOneScope), {
        validTeamIds: new Set(['team-a', 'team-b'])
    });

    saveTeamSelectionState(storage, sprintTwoScope, preserved);

    assert.deepEqual(
        loadTeamSelectionState(storage, sprintTwoScope),
        {
            selectedTeams: ['team-a'],
            selectedTeamId: 'team-a'
        }
    );
});
