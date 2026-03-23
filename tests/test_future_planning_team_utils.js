const test = require('node:test');
const assert = require('node:assert/strict');

test('future planning team selection can match by configured team label', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        epicMatchesFuturePlanningTeamSelection,
        getFuturePlanningEpicTeamInfo
    }) => {
        const epic = {
            key: 'PRODUCT-34931',
            teamId: 'product-team',
            teamName: 'Product - BidSwitch',
            labels: ['2026Q2', 'rnd_bsw_perimeter']
        };
        const selectedTeamSet = new Set(['perimeter-team']);
        const teamLabels = {
            'perimeter-team': 'rnd_bsw_perimeter'
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
                    'perimeter-team': 'R&D Perimeter'
                }[teamId] || teamId)
            }),
            { id: 'perimeter-team', name: 'R&D Perimeter' }
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
            key: 'PRODUCT-100',
            teamId: 'product-team',
            teamName: 'Product - BidSwitch',
            labels: ['2026Q2']
        };
        const selectedTeamSet = new Set(['perimeter-team']);
        const teamLabels = {
            'perimeter-team': 'rnd_bsw_perimeter'
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
            { id: 'product-team', name: 'Product - BidSwitch' }
        );

        assert.equal(
            getFuturePlanningExpectedTeamLabel(epic, {
                selectedTeamSet,
                teamLabels
            }),
            'rnd_bsw_perimeter'
        );
    });
});

test('future planning team info follows the single selected planning team', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        getFuturePlanningEpicTeamInfo
    }) => {
        const epic = {
            key: 'PRODUCT-101',
            teamId: 'product-team',
            teamName: 'Product - BidSwitch',
            labels: ['2026Q2']
        };
        const selectedTeamSet = new Set(['perimeter-team']);
        const teamLabels = {
            'perimeter-team': 'rnd_bsw_perimeter'
        };

        assert.deepEqual(
            getFuturePlanningEpicTeamInfo(epic, {
                selectedTeamSet,
                teamLabels,
                resolveTeamName: (teamId) => ({
                    'perimeter-team': 'R&D Perimeter'
                }[teamId] || teamId)
            }),
            { id: 'perimeter-team', name: 'R&D Perimeter' }
        );
    });
});

test('future planning team info uses fallback selected team name when lookup misses', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        getFuturePlanningEpicTeamInfo
    }) => {
        const epic = {
            key: 'PRODUCT-102',
            teamId: 'product-team',
            teamName: 'Product - BidSwitch',
            labels: ['2026Q2']
        };
        const selectedTeamSet = new Set(['perimeter-team']);

        assert.deepEqual(
            getFuturePlanningEpicTeamInfo(epic, {
                selectedTeamSet,
                teamLabels: {},
                resolveTeamName: (teamId) => teamId,
                fallbackSelectedTeamName: 'R&D Perimeter'
            }),
            { id: 'perimeter-team', name: 'R&D Perimeter' }
        );
    });
});

test('future planning team info uses provided team name map for matched team ids', () => {
    return import('../frontend/src/futurePlanningTeamUtils.mjs').then(({
        getFuturePlanningEpicTeamInfo
    }) => {
        const epic = {
            key: 'PRODUCT-103',
            teamId: 'product-team',
            teamName: 'Product - BidSwitch',
            labels: ['2026Q2', 'rnd_bsw_adlightning']
        };

        assert.deepEqual(
            getFuturePlanningEpicTeamInfo(epic, {
                selectedTeamSet: new Set(['product-team', 'adlightning-team']),
                teamLabels: {
                    'adlightning-team': 'rnd_bsw_adlightning'
                },
                resolveTeamName: (teamId) => teamId,
                teamNameById: new Map([
                    ['adlightning-team', 'AdLightning']
                ])
            }),
            { id: 'adlightning-team', name: 'AdLightning' }
        );
    });
});
