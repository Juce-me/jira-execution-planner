const test = require('node:test');
const assert = require('node:assert/strict');

test('future planning team selection can match by configured team label', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        epicMatchesFuturePlanningTeamSelection,
        getFuturePlanningEpicTeamInfo
    }) => {
        const epic = {
            key: 'EPIC-201',
            teamId: 'jira-team-alpha',
            teamName: 'Synthetic Jira Team Alpha',
            labels: ['FUTURE_SPRINT_1', 'team_alpha_label']
        };
        const selectedTeamSet = new Set(['planning-team-alpha']);
        const teamLabels = {
            'planning-team-alpha': 'team_alpha_label'
        };

        assert.equal(
            epicMatchesFuturePlanningTeamSelection(epic, {
                isAllTeamsSelected: false,
                selectedTeamSet,
                teamLabels
            }),
            true
        );

        assert.deepEqual(
            getFuturePlanningEpicTeamInfo(epic, {
                teamLabels,
                resolveTeamName: (teamId) => ({
                    'planning-team-alpha': 'Planning Team Alpha'
                }[teamId] || teamId)
            }),
            { id: 'planning-team-alpha', name: 'Planning Team Alpha' }
        );
    });
});

test('future planning team info falls back to jira team when no label mapping matches', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        epicMatchesFuturePlanningTeamSelection,
        getFuturePlanningEpicTeamInfo,
        getFuturePlanningExpectedTeamLabels
    }) => {
        const epic = {
            key: 'EPIC-202',
            teamId: 'jira-team-beta',
            teamName: 'Synthetic Jira Team Beta',
            labels: ['FUTURE_SPRINT_1']
        };
        const selectedTeamSet = new Set(['planning-team-alpha']);
        const teamLabels = {
            'planning-team-alpha': 'team_alpha_label'
        };

        assert.equal(
            epicMatchesFuturePlanningTeamSelection(epic, {
                isAllTeamsSelected: false,
                selectedTeamSet,
                teamLabels
            }),
            false
        );

        assert.deepEqual(
            getFuturePlanningEpicTeamInfo(epic, {
                teamLabels,
                resolveTeamName: (teamId) => teamId
            }),
            { id: 'jira-team-beta', name: 'Synthetic Jira Team Beta' }
        );

        assert.deepEqual(
            getFuturePlanningExpectedTeamLabels(epic, {
                selectedTeamSet,
                teamLabels
            }),
            ['team_alpha_label']
        );
    });
});

test('future planning team info follows the single selected planning team', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        getFuturePlanningEpicTeamInfo
    }) => {
        const epic = {
            key: 'EPIC-203',
            teamId: 'jira-team-beta',
            teamName: 'Synthetic Jira Team Beta',
            labels: ['FUTURE_SPRINT_1']
        };
        const selectedTeamSet = new Set(['planning-team-alpha']);
        const teamLabels = {
            'planning-team-alpha': 'team_alpha_label'
        };

        assert.deepEqual(
            getFuturePlanningEpicTeamInfo(epic, {
                selectedTeamSet,
                teamLabels,
                resolveTeamName: (teamId) => ({
                    'planning-team-alpha': 'Planning Team Alpha'
                }[teamId] || teamId)
            }),
            { id: 'planning-team-alpha', name: 'Planning Team Alpha' }
        );
    });
});

test('future planning team info uses fallback selected team name when lookup misses', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        getFuturePlanningEpicTeamInfo
    }) => {
        const epic = {
            key: 'EPIC-204',
            teamId: 'jira-team-beta',
            teamName: 'Synthetic Jira Team Beta',
            labels: ['FUTURE_SPRINT_1']
        };
        const selectedTeamSet = new Set(['planning-team-alpha']);

        assert.deepEqual(
            getFuturePlanningEpicTeamInfo(epic, {
                selectedTeamSet,
                teamLabels: {},
                resolveTeamName: (teamId) => teamId,
                fallbackSelectedTeamName: 'Planning Team Alpha'
            }),
            { id: 'planning-team-alpha', name: 'Planning Team Alpha' }
        );
    });
});

test('future planning team info uses provided team name map for matched team ids', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        getFuturePlanningEpicTeamInfo
    }) => {
        const epic = {
            key: 'EPIC-205',
            teamId: 'jira-team-beta',
            teamName: 'Synthetic Jira Team Beta',
            labels: ['FUTURE_SPRINT_1', 'team_gamma_label']
        };

        assert.deepEqual(
            getFuturePlanningEpicTeamInfo(epic, {
                selectedTeamSet: new Set(['jira-team-beta', 'planning-team-gamma']),
                teamLabels: {
                    'planning-team-gamma': 'team_gamma_label'
                },
                resolveTeamName: (teamId) => teamId,
                teamNameById: new Map([
                    ['planning-team-gamma', 'Planning Team Gamma']
                ])
            }),
            { id: 'planning-team-gamma', name: 'Planning Team Gamma' }
        );
    });
});

test('future planning expected label accepts multi-team epics in all teams view', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        getFuturePlanningExpectedTeamLabels
    }) => {
        const epic = {
            key: 'EPIC-206',
            teamId: 'product-team',
            teamName: 'Product Team',
            labels: ['2026Q3', 'team_alpha_label', 'team_beta_label']
        };
        const teamLabels = {
            'planning-team-alpha': 'team_alpha_label',
            'planning-team-beta': 'team_beta_label'
        };

        assert.deepEqual(
            getFuturePlanningExpectedTeamLabels(epic, {
                selectedTeamSet: new Set(),
                teamLabels
            }),
            ['team_alpha_label']
        );
    });
});

test('future planning team infos use every matched team label before raw jira team', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        getFuturePlanningEpicTeamInfos
    }) => {
        const epic = {
            key: 'EPIC-207',
            teamId: 'raw-product-team',
            teamName: 'Raw Product Team',
            labels: ['2026Q3', 'team_alpha_label', 'team_beta_label', 'team_gamma_label']
        };
        const teamLabels = {
            'planning-team-alpha': 'team_alpha_label',
            'planning-team-beta': 'team_beta_label',
            'planning-team-gamma': 'team_gamma_label'
        };
        const teamNameById = new Map([
            ['planning-team-alpha', 'Planning Team Alpha'],
            ['planning-team-beta', 'Planning Team Beta'],
            ['planning-team-gamma', 'Planning Team Gamma']
        ]);

        assert.deepEqual(
            getFuturePlanningEpicTeamInfos(epic, {
                selectedTeamSet: new Set(),
                teamLabels,
                teamNameById
            }),
            [
                { id: 'planning-team-alpha', name: 'Planning Team Alpha' },
                { id: 'planning-team-beta', name: 'Planning Team Beta' },
                { id: 'planning-team-gamma', name: 'Planning Team Gamma' }
            ]
        );
    });
});

test('futurePlanningTeamUtils no longer exports the semantic needs-stories JQL builder', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then((mod) => {
        // A label/sprint JQL cannot reproduce the client-side alert list (per-team
        // story coverage, dismissed alerts, team-field fallback routing), so the
        // team link must come from the rendered epic keys instead.
        assert.equal(mod.buildNeedsStoriesTeamJql, undefined);
    });
});

const aliasTeamLabels = { 'team-a': ['label_team_a', 'label_team_a_old'] };
for (const [description, labels, expected] of [
    ['old alias only', ['FUTURE_SPRINT_1', 'label_team_a_old'], true],
    ['new alias only', ['FUTURE_SPRINT_1', 'label_team_a'], true],
    ['both aliases', ['FUTURE_SPRINT_1', 'label_team_a', 'LABEL_TEAM_A_OLD'], true],
    ['neither alias', ['FUTURE_SPRINT_1', 'unrelated_label'], false]
]) {
    test(`future planning Team label predicate: ${description} across Team resolution paths`, async () => {
        const { epicHasFuturePlanningTeamLabel, getFuturePlanningExpectedTeamLabels } = await import('../frontend/src/futurePlanningTeamUtils.mjs');
        // Resolved by the single selected Team.
        const selectedEpic = { key: 'PROJ-1', teamId: 'other-team', teamName: 'Other', labels };
        assert.equal(
            epicHasFuturePlanningTeamLabel(selectedEpic, { selectedTeamSet: new Set(['team-a']), teamLabels: aliasTeamLabels }),
            expected
        );
        // Resolved by the Epic's Jira Team id.
        const jiraTeamEpic = { key: 'PROJ-1', teamId: 'team-a', teamName: 'Team A', labels };
        assert.equal(
            epicHasFuturePlanningTeamLabel(jiraTeamEpic, { selectedTeamSet: new Set(), teamLabels: aliasTeamLabels }),
            expected
        );
        assert.deepEqual(
            getFuturePlanningExpectedTeamLabels(jiraTeamEpic, { selectedTeamSet: new Set(), teamLabels: aliasTeamLabels }),
            ['label_team_a', 'label_team_a_old']
        );
        // Resolved by the first label-matched Team (Jira Team has no mapping).
        const labelMatchedEpic = { key: 'PROJ-1', teamId: 'unmapped-team', teamName: 'Unmapped', labels };
        assert.equal(
            epicHasFuturePlanningTeamLabel(labelMatchedEpic, { selectedTeamSet: new Set(), teamLabels: aliasTeamLabels }),
            expected
        );
        assert.deepEqual(
            getFuturePlanningExpectedTeamLabels(labelMatchedEpic, { selectedTeamSet: new Set(), teamLabels: aliasTeamLabels }),
            expected ? ['label_team_a', 'label_team_a_old'] : []
        );
    });
}

test('future planning Team label helpers accept legacy scalar mappings', async () => {
    const { epicHasFuturePlanningTeamLabel, getFuturePlanningExpectedTeamLabels } = await import('../frontend/src/futurePlanningTeamUtils.mjs');
    const epic = { key: 'PROJ-1', teamId: 'team-a', teamName: 'Team A', labels: ['label_team_a'] };
    const teamLabels = { 'team-a': ' label_team_a ' };
    assert.deepEqual(getFuturePlanningExpectedTeamLabels(epic, { selectedTeamSet: new Set(), teamLabels }), ['label_team_a']);
    assert.equal(epicHasFuturePlanningTeamLabel(epic, { selectedTeamSet: new Set(), teamLabels }), true);
    assert.equal(epicHasFuturePlanningTeamLabel(epic, { selectedTeamSet: new Set(['team-b']), teamLabels }), false);
});

test('future planning Team selection matches any alias and yields one group per Team', async () => {
    const {
        epicMatchesFuturePlanningTeamSelection,
        getFuturePlanningEpicTeamInfos
    } = await import('../frontend/src/futurePlanningTeamUtils.mjs');
    const teamLabels = {
        'team-a': ['label_team_a', 'label_team_a_old'],
        'team-b': ['label_team_b']
    };
    const oldOnly = { key: 'PROJ-1', teamId: 'raw-team', teamName: 'Raw', labels: ['label_team_a_old'] };
    assert.equal(epicMatchesFuturePlanningTeamSelection(oldOnly, { selectedTeamSet: new Set(['team-a']), teamLabels }), true);
    assert.equal(epicMatchesFuturePlanningTeamSelection(oldOnly, { selectedTeamSet: new Set(['team-b']), teamLabels }), false);

    const bothAliases = { key: 'PROJ-1', teamId: 'raw-team', teamName: 'Raw', labels: ['label_team_a', 'label_team_a_old'] };
    assert.deepEqual(
        getFuturePlanningEpicTeamInfos(bothAliases, { selectedTeamSet: new Set(), teamLabels, teamNameById: new Map([['team-a', 'Team A']]) }),
        [{ id: 'team-a', name: 'Team A' }]
    );

    const twoTeams = { key: 'PROJ-1', teamId: 'raw-team', teamName: 'Raw', labels: ['label_team_a_old', 'label_team_b'] };
    assert.deepEqual(
        getFuturePlanningEpicTeamInfos(twoTeams, {
            selectedTeamSet: new Set(),
            teamLabels,
            teamNameById: new Map([['team-a', 'Team A'], ['team-b', 'Team B']])
        }),
        [{ id: 'team-a', name: 'Team A' }, { id: 'team-b', name: 'Team B' }]
    );
});

test('futurePlanningTeamUtils no longer exports the scalar expected Team label helper', async () => {
    const mod = await import('../frontend/src/futurePlanningTeamUtils.mjs');
    assert.equal(mod.getFuturePlanningExpectedTeamLabel, undefined);
});
