const test = require('node:test');
const assert = require('node:assert/strict');

test('buildTeamSelectionScopeKey composes sprint and group into a stable scope key', async () => {
    const {
        buildTeamSelectionScopeKey
    } = await import('../frontend/src/teamSelectionPersistence.mjs');

    assert.equal(
        buildTeamSelectionScopeKey({ sprintId: '2026Q2', groupId: 'group-alpha' }),
        'team-selection::2026Q2::group-alpha'
    );
});

test('team selection persistence round-trips through scoped browser storage', async () => {
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

test('team selection hydration prefers scoped storage over stale global all-team prefs', async () => {
    const {
        resolveTeamSelectionHydrationState
    } = await import('../frontend/src/teamSelectionPersistence.mjs');

    assert.deepEqual(
        resolveTeamSelectionHydrationState({
            storedState: {
                selectedTeams: ['team-a'],
                selectedTeamId: 'team-a'
            },
            savedPrefsSelectedTeams: ['all']
        }),
        {
            selectedTeams: ['team-a'],
            selectedTeamId: 'team-a'
        }
    );
});

test('team selection hydration uses live selection before stale global prefs for new scope', async () => {
    const {
        resolveTeamSelectionHydrationState
    } = await import('../frontend/src/teamSelectionPersistence.mjs');

    assert.deepEqual(
        resolveTeamSelectionHydrationState({
            liveSelectedTeams: ['team-a'],
            savedPrefsSelectedTeams: ['all']
        }),
        {
            selectedTeams: ['team-a'],
            selectedTeamId: 'team-a'
        }
    );
});

test('team selection hydration lets carried live selection override stale scoped storage', async () => {
    const {
        resolveTeamSelectionHydrationState
    } = await import('../frontend/src/teamSelectionPersistence.mjs');

    assert.deepEqual(
        resolveTeamSelectionHydrationState({
            storedState: {
                selectedTeams: ['team-a'],
                selectedTeamId: 'team-a'
            },
            liveSelectedTeams: ['all']
        }),
        {
            selectedTeams: ['all'],
            selectedTeamId: 'all'
        }
    );
});

test('reconcileTeamSelectionState falls back to all when the selected team is invalid', async () => {
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
