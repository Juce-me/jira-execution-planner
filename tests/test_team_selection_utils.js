const test = require('node:test');
const assert = require('node:assert/strict');

test('team selection resets to all when the selected team is absent from the authoritative available-team catalog', () => {
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

test('configured group teams stay available when fetched task data omits the selected team', async () => {
    const { buildTeamOptionsForScope } = await import('../frontend/src/teamSelectionUtils.mjs');
    const getTeamInfo = task => ({ id: task?.teamId, name: task?.teamName });

    assert.deepEqual(
        buildTeamOptionsForScope({
            capacityTasks: [{ teamId: 'team-beta', teamName: 'Beta Team' }],
            activeGroupTeamIds: ['team-alpha', 'team-beta'],
            teamNameLookup: {
                'team-alpha': 'Alpha Team',
                'team-beta': 'Beta Team'
            },
            getTeamInfo
        }),
        [
            { id: 'all', name: 'All Teams' },
            { id: 'team-alpha', name: 'Alpha Team' },
            { id: 'team-beta', name: 'Beta Team' }
        ]
    );
});

test('team options fall back to fetched task teams only without configured group teams', async () => {
    const { buildTeamOptionsForScope } = await import('../frontend/src/teamSelectionUtils.mjs');
    const getTeamInfo = task => ({ id: task?.teamId, name: task?.teamName });

    assert.deepEqual(
        buildTeamOptionsForScope({
            capacityTasks: [
                { teamId: 'team-alpha', teamName: 'Alpha Team' },
                { teamId: 'team-alpha', teamName: 'Alpha Team' },
                { teamId: 'team-beta', teamName: 'Beta Team' }
            ],
            activeGroupTeamIds: [],
            teamNameLookup: {},
            getTeamInfo
        }),
        [
            { id: 'all', name: 'All Teams' },
            { id: 'team-alpha', name: 'Alpha Team' },
            { id: 'team-beta', name: 'Beta Team' }
        ]
    );
});

test('configured team options dedupe repeated IDs and drop blank IDs', async () => {
    const { buildTeamOptionsForScope } = await import('../frontend/src/teamSelectionUtils.mjs');
    const getTeamInfo = task => ({ id: task?.teamId, name: task?.teamName });

    assert.deepEqual(
        buildTeamOptionsForScope({
            capacityTasks: [],
            activeGroupTeamIds: ['team-alpha', 'team-alpha', ' ', 'team-beta'],
            teamNameLookup: {
                'team-alpha': 'Alpha Team',
                'team-beta': 'Beta Team'
            },
            getTeamInfo
        }),
        [
            { id: 'all', name: 'All Teams' },
            { id: 'team-alpha', name: 'Alpha Team' },
            { id: 'team-beta', name: 'Beta Team' }
        ]
    );
});

test('configured team names resolve from the catalog lookup, then task data, then the raw id', async () => {
    const { buildTeamOptionsForScope } = await import('../frontend/src/teamSelectionUtils.mjs');
    const getTeamInfo = task => ({ id: task?.teamId, name: task?.teamName });

    assert.deepEqual(
        buildTeamOptionsForScope({
            capacityTasks: [{ teamId: 'team-beta', teamName: 'Beta From Task' }],
            activeGroupTeamIds: ['team-alpha', 'team-beta', 'team-gamma'],
            teamNameLookup: { 'team-alpha': 'Alpha Team' },
            getTeamInfo
        }),
        [
            { id: 'all', name: 'All Teams' },
            { id: 'team-alpha', name: 'Alpha Team' },
            { id: 'team-beta', name: 'Beta From Task' },
            { id: 'team-gamma', name: 'team-gamma' }
        ]
    );
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

test('team dropdown lists All Teams first, then teams alphabetically', async () => {
    const { buildTeamDropdownOptions } = await import('../frontend/src/teamSelectionUtils.mjs');
    const teamOptions = [
        { id: 'all', name: 'All Teams' },
        { id: 't-dist', name: 'R&D Distribution' },
        { id: 't-bsw-ui', name: 'R&D BSW UI' },
        { id: 't-aaew', name: 'R&D AAEW' },
        { id: 't-bsw-fin', name: 'R&D BSW FinancialTools v-team' }
    ];

    assert.deepEqual(
        buildTeamDropdownOptions({ teamOptions, workKnown: false }).map(team => team.name),
        ['All Teams', 'R&D AAEW', 'R&D BSW FinancialTools v-team', 'R&D BSW UI', 'R&D Distribution']
    );
    assert.deepEqual(teamOptions.map(team => team.id), ['all', 't-dist', 't-bsw-ui', 't-aaew', 't-bsw-fin'], 'the source options keep their configured order');
});

test('team dropdown drops teams with no stories or awaited stories once the sprint work is known', async () => {
    const { buildTeamDropdownOptions } = await import('../frontend/src/teamSelectionUtils.mjs');
    const getTeamInfo = task => ({ id: task.teamId, name: task.teamName });
    const teamOptions = [
        { id: 'all', name: 'All Teams' },
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
        { id: 'gamma', name: 'Gamma' },
        { id: 'delta', name: 'Delta' }
    ];

    const options = buildTeamDropdownOptions({
        teamOptions,
        tasks: [{ teamId: 'beta', teamName: 'Beta' }],
        getTeamInfo,
        readinessEpics: [{ key: 'EPIC-1', missingTeams: [{ id: 'gamma', name: 'Gamma' }] }],
        workKnown: true
    });

    assert.deepEqual(options.map(team => team.id), ['all', 'beta', 'gamma']);
});

test('team dropdown keeps every team while sprint work or awaited stories are unknown', async () => {
    const { buildTeamDropdownOptions } = await import('../frontend/src/teamSelectionUtils.mjs');
    const teamOptions = [
        { id: 'all', name: 'All Teams' },
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' }
    ];

    assert.deepEqual(
        buildTeamDropdownOptions({ teamOptions, tasks: [], getTeamInfo: () => ({}), workKnown: false }).map(team => team.id),
        ['all', 'alpha', 'beta']
    );
});

test('team dropdown keeps a selected team that has no work so it can be unticked', async () => {
    const { buildTeamDropdownOptions } = await import('../frontend/src/teamSelectionUtils.mjs');
    const teamOptions = [
        { id: 'all', name: 'All Teams' },
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' }
    ];

    assert.deepEqual(
        buildTeamDropdownOptions({
            teamOptions, tasks: [], getTeamInfo: () => ({}), readinessEpics: [], workKnown: true, selectedTeamIds: new Set(['beta'])
        }).map(team => team.id),
        ['all', 'beta']
    );
});

test('team dropdown with no work in the sprint offers only All Teams', async () => {
    const { buildTeamDropdownOptions } = await import('../frontend/src/teamSelectionUtils.mjs');

    assert.deepEqual(
        buildTeamDropdownOptions({
            teamOptions: [{ id: 'all', name: 'All Teams' }, { id: 'alpha', name: 'Alpha' }],
            tasks: [], getTeamInfo: () => ({}), readinessEpics: [], workKnown: true
        }),
        [{ id: 'all', name: 'All Teams' }]
    );
});
