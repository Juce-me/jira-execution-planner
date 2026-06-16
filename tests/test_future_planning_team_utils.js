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
        getFuturePlanningExpectedTeamLabel
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

        assert.equal(
            getFuturePlanningExpectedTeamLabel(epic, {
                selectedTeamSet,
                teamLabels
            }),
            'team_alpha_label'
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
        getFuturePlanningExpectedTeamLabel
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

        assert.equal(
            getFuturePlanningExpectedTeamLabel(epic, {
                selectedTeamSet: new Set(),
                teamLabels
            }),
            'team_alpha_label'
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
